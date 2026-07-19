#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path'
import { pathToFileURL } from 'node:url'

const LOCAL_AUTH_CALLBACK_URL = 'http://127.0.0.1:5173/api/auth/callback/tachyon'
const LOCAL_AUTH_ORIGIN = 'http://127.0.0.1:5173'
const LOCAL_BFF_ORIGIN = 'http://localhost:3001'
const COGNITO_ISSUER = 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_8Ga4bK5M4'
const COGNITO_DOMAIN = 'https://auth-pool.n1.tachy.one'
const FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'
const LOCAL_COURSE_API_URL = 'http://127.0.0.1:8080'
const REQUIRED_SCOPES = [
  'openid',
  'profile',
  'email',
  'aws.cognito.signin.user.admin',
]
const REQUIRED_GRANT_TYPES = ['authorization_code', 'password']
const BROWSER_PKCE_ENV_KEYS = [
  'VITE_COURSEBOARD_BROWSER_CLIENT_ID',
  'VITE_COURSEBOARD_BROWSER_REDIRECT_URI',
  'VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_SCOPES',
]
// Static development bearer must not remain when switching to real Auth.js login.
const DEVELOPMENT_UI_ENV_KEYS = [
  'VITE_COURSEBOARD_API_BEARER',
  'VITE_COURSEBOARD_TENANT_ID',
  'VITE_COURSEBOARD_OPERATOR_ID',
]
const COURSE_API_STATIC_BEARER_KEYS = [
  'COURSEBOARD_DEV_BEARER_TOKEN',
]

const defaults = {
  apiUrl: 'https://api.n1.tachy.one',
  callbackUrl: LOCAL_AUTH_CALLBACK_URL,
  clientName: 'courseboard-local-web',
  tenantId: 'tn_01ks18jhh1xvggktfzjx5jqsen',
  uiEnvFile: '.env.local',
  webHostEnvFile: 'web-host/.env.local',
  // Course-api env for OIDC verification of Cognito user JWTs + prod Field.
  apiEnvFile: '../.env.web-session',
}

function usage() {
  console.log(`Usage: npm run auth:env -- [options]

Options:
  --profile <name>             Tachyon CLI profile (default: active profile)
  --tenant-id <id>            OAuth client owner tenant
  --client-name <name>        Local confidential OAuth client name
  --ui-env-file <path>        Vite env file (default: .env.local)
  --web-host-env-file <path>  Auth.js BFF env file (default: web-host/.env.local)
  --api-env-file <path>       course-api env file (default: ../.env.web-session)
  --callback-url <url>        Auth.js callback URL
  --api-url <url>             Tachyon API base URL
  --rotate-secret             Rotate an existing client when its local secret is unavailable
  --dry-run                   Validate and report without creating, rotating, or writing
  --help                      Show this help`)
}

export function parseArgs(argv, environment = process.env) {
  const options = {
    ...defaults,
    dryRun: false,
    profile: environment.TACHYON_PROFILE,
    rotateSecret: false,
  }
  const valueOptions = new Map([
    ['--profile', 'profile'],
    ['--tenant-id', 'tenantId'],
    ['--client-name', 'clientName'],
    ['--ui-env-file', 'uiEnvFile'],
    ['--web-host-env-file', 'webHostEnvFile'],
    ['--api-env-file', 'apiEnvFile'],
    ['--callback-url', 'callbackUrl'],
    ['--api-url', 'apiUrl'],
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (argument === '--rotate-secret') {
      options.rotateSecret = true
      continue
    }
    const key = valueOptions.get(argument)
    if (!key) throw new Error(`Unknown option: ${argument}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    options[key] = value
    index += 1
  }
  return options
}

function tachyonConfigDirectory() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'tachyon')
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'tachyon')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tachyon')
}

function activeProfile(configDirectory, requestedProfile) {
  if (requestedProfile?.trim()) return requestedProfile.trim()
  const activeProfileFile = join(configDirectory, 'active_profile')
  if (existsSync(activeProfileFile)) {
    const value = readFileSync(activeProfileFile, 'utf8').trim()
    if (value) return value
  }
  return 'default'
}

function refreshCliProfile(profile) {
  const result = spawnSync(
    'tachyon',
    ['org', 'operators', 'list', '--json', '--profile', profile],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.error?.code === 'ENOENT') {
    throw new Error('Tachyon CLIが見つかりません。tachyonをインストールしてください。')
  }
  if (result.status !== 0) {
    throw new Error(`Tachyon profile '${profile}'を更新できません。tachyon auth login --profile ${profile} を実行してください。`)
  }
}

function profileCredentials(configDirectory, profile) {
  const profileFile = join(configDirectory, 'profiles', `${profile}.json`)
  const legacyFile = join(configDirectory, 'credentials.json')
  const credentialsFile = existsSync(profileFile) ? profileFile : legacyFile
  if (!existsSync(credentialsFile)) {
    throw new Error(`Tachyon profile '${profile}'がありません。tachyon auth login --profile ${profile} を実行してください。`)
  }
  const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'))
  if (typeof credentials.access_token !== 'string' || !credentials.access_token) {
    throw new Error(`Tachyon profile '${profile}'にaccess tokenがありません。`)
  }
  return credentials
}

function absolutePath(filePath) {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
}

export function parseEnvFile(content) {
  const values = {}
  for (const line of content.split('\n')) {
    const separator = line.indexOf('=')
    if (separator <= 0 || line.trimStart().startsWith('#')) continue
    values[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return values
}

function readEnvFile(filePath) {
  const path = absolutePath(filePath)
  return existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : {}
}

export function updateEnvContent(existing, values, removeKeys = []) {
  const removed = new Set(removeKeys)
  const written = new Set()
  const lines = existing ? existing.replace(/\n$/, '').split('\n') : []
  const updated = []

  for (const line of lines) {
    const separator = line.indexOf('=')
    if (separator <= 0) {
      updated.push(line)
      continue
    }
    const key = line.slice(0, separator)
    if (removed.has(key)) continue
    if (!(key in values)) {
      updated.push(line)
      continue
    }
    updated.push(`${key}=${values[key]}`)
    written.add(key)
  }

  const missing = Object.keys(values).filter(key => !written.has(key))
  if (missing.length > 0) {
    if (updated.length > 0 && updated.at(-1) !== '') updated.push('')
    updated.push('# Managed by npm run auth:env. Secrets stay in ignored local files.')
    for (const key of missing) updated.push(`${key}=${values[key]}`)
  }
  return `${updated.join('\n')}\n`
}

function writeEnvFile(filePath, values, removeKeys = []) {
  const path = absolutePath(filePath)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const temporaryPath = join(dirname(path), `.${basename(path)}.tmp`)
  writeFileSync(temporaryPath, updateEnvContent(existing, values, removeKeys), {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, path)
  chmodSync(path, 0o600)
  return path
}

function authHeaders(accessToken, tenantId, extra = {}) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'x-operator-id': tenantId,
    ...extra,
  }
}

async function requestJson(url, init, action) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${action}できませんでした (HTTP ${response.status})。profileとtenantを確認してください。`)
  }
  return response.json()
}

async function listClients({ accessToken, apiUrl, tenantId }) {
  return requestJson(
    `${apiUrl.replace(/\/$/, '')}/v1/auth/oauth2-clients`,
    { headers: authHeaders(accessToken, tenantId) },
    'OAuth client一覧を取得',
  )
}

function hasRequiredValues(actual, required) {
  return required.every(value => actual.includes(value))
}

export function usableSecret(value) {
  return typeof value === 'string'
    && value.length >= 24
    && !/(dummy|example|placeholder|change[-_]?me|local[-_]?secret)/i.test(value)
}

async function createClient({ accessToken, apiUrl, callbackUrl, clientName, tenantId }) {
  return requestJson(
    `${apiUrl.replace(/\/$/, '')}/v1/auth/oauth2-clients`,
    {
      method: 'POST',
      headers: authHeaders(accessToken, tenantId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: clientName,
        redirectUris: [callbackUrl],
        allowedScopes: REQUIRED_SCOPES,
        grantTypes: REQUIRED_GRANT_TYPES,
        useTachyonUserPool: true,
        clientType: 'confidential',
      }),
    },
    'ローカルCognito clientを作成',
  )
}

async function updateClient({ accessToken, apiUrl, callbackUrl, client, tenantId }) {
  const redirectUris = [...new Set([...client.redirectUris, callbackUrl])]
  const allowedScopes = [...new Set([...client.allowedScopes, ...REQUIRED_SCOPES])]
  return requestJson(
    `${apiUrl.replace(/\/$/, '')}/v1/auth/oauth2-clients/${client.id}`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken, tenantId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ redirectUris, allowedScopes }),
    },
    'ローカルCognito clientを更新',
  )
}

async function rotateClientSecret({ accessToken, apiUrl, client, tenantId }) {
  return requestJson(
    `${apiUrl.replace(/\/$/, '')}/v1/auth/oauth2-clients/${client.id}/rotate-secret`,
    {
      method: 'POST',
      headers: authHeaders(accessToken, tenantId),
    },
    'ローカルCognito client secretをローテーション',
  )
}

async function ensureLocalClient(options, accessToken, existingWebHostEnv) {
  const payload = await listClients({
    accessToken,
    apiUrl: options.apiUrl,
    tenantId: options.tenantId,
  })
  const clients = Array.isArray(payload.clients) ? payload.clients : []
  const matches = clients.filter(client =>
    client?.name === options.clientName && client?.status === 'active',
  )
  if (matches.length > 1) {
    throw new Error(`activeなOAuth client '${options.clientName}'が複数あります。`)
  }

  if (matches.length === 0) {
    if (options.dryRun) {
      return { action: 'create', clientId: undefined, clientSecret: undefined }
    }
    const created = await createClient({
      accessToken,
      apiUrl: options.apiUrl,
      callbackUrl: options.callbackUrl,
      clientName: options.clientName,
      tenantId: options.tenantId,
    })
    if (!usableSecret(created.clientSecret)) {
      throw new Error('TachyonがローカルCognito client secretを返しませんでした。')
    }
    return {
      action: 'created',
      clientId: created.clientId,
      clientSecret: created.clientSecret,
    }
  }

  let client = matches[0]
  if (!client.useTachyonUserPool) {
    throw new Error(`OAuth client '${options.clientName}'はTachyon User Poolを使用していません。別のclient名を指定してください。`)
  }
  if (!hasRequiredValues(client.grantTypes ?? [], ['authorization_code'])) {
    throw new Error(`OAuth client '${options.clientName}'はauthorization_code grantに対応していません。`)
  }
  if (!client.redirectUris?.includes(options.callbackUrl)) {
    if (options.dryRun) {
      return { action: 'update', clientId: client.clientId, clientSecret: undefined }
    }
    client = await updateClient({
      accessToken,
      apiUrl: options.apiUrl,
      callbackUrl: options.callbackUrl,
      client,
      tenantId: options.tenantId,
    })
  }

  if (
    existingWebHostEnv.COGNITO_CLIENT_ID === client.clientId
    && usableSecret(existingWebHostEnv.COGNITO_CLIENT_SECRET)
  ) {
    return {
      action: 'reused',
      clientId: client.clientId,
      clientSecret: existingWebHostEnv.COGNITO_CLIENT_SECRET,
    }
  }
  if (options.dryRun) {
    return { action: 'rotate-required', clientId: client.clientId, clientSecret: undefined }
  }
  if (!options.rotateSecret) {
    throw new Error(`OAuth client '${options.clientName}'は存在しますがlocal secretがありません。npm run auth:env -- --rotate-secret を実行してください。`)
  }
  const rotated = await rotateClientSecret({
    accessToken,
    apiUrl: options.apiUrl,
    client,
    tenantId: options.tenantId,
  })
  if (!usableSecret(rotated.newClientSecret)) {
    throw new Error('Tachyonがローテーション後のclient secretを返しませんでした。')
  }
  return {
    action: 'rotated',
    clientId: rotated.clientId,
    clientSecret: rotated.newClientSecret,
  }
}

function authSecret(existingWebHostEnv) {
  const existing = existingWebHostEnv.AUTH_SECRET ?? existingWebHostEnv.NEXTAUTH_SECRET
  return usableSecret(existing) ? existing : randomBytes(32).toString('base64url')
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    usage()
    return
  }
  const callback = new URL(options.callbackUrl)
  if (callback.origin !== LOCAL_AUTH_ORIGIN || callback.pathname !== '/api/auth/callback/tachyon') {
    throw new Error(`--callback-url must be ${LOCAL_AUTH_CALLBACK_URL}`)
  }

  const configDirectory = tachyonConfigDirectory()
  const profile = activeProfile(configDirectory, options.profile)
  refreshCliProfile(profile)
  const credentials = profileCredentials(configDirectory, profile)
  const existingWebHostEnv = readEnvFile(options.webHostEnvFile)
  const localClient = await ensureLocalClient(
    options,
    credentials.access_token,
    existingWebHostEnv,
  )

  if (options.dryRun) {
    console.log(`Validated Tachyon profile '${profile}'.`)
    console.log(`Local Cognito client action: ${localClient.action}.`)
    console.log(
      `Would configure ${options.uiEnvFile}, ${options.webHostEnvFile}, and ${options.apiEnvFile}.`,
    )
    return
  }

  const sessionSecret = authSecret(existingWebHostEnv)
  const uiPath = writeEnvFile(
    options.uiEnvFile,
    {
      VITE_COURSEBOARD_AUTH_MODE: 'web-session',
      VITE_AUTH_PROXY_TARGET: LOCAL_BFF_ORIGIN,
      VITE_DEV_API_PROXY_TARGET: LOCAL_BFF_ORIGIN,
      VITE_COURSEBOARD_MODE: 'production',
      VITE_COURSEBOARD_MOCK_DATA: 'false',
    },
    [...BROWSER_PKCE_ENV_KEYS, ...DEVELOPMENT_UI_ENV_KEYS],
  )
  const webHostPath = writeEnvFile(options.webHostEnvFile, {
    AUTH_URL: LOCAL_AUTH_ORIGIN,
    NEXTAUTH_URL: LOCAL_AUTH_ORIGIN,
    AUTH_SECRET: sessionSecret,
    NEXTAUTH_SECRET: sessionSecret,
    COGNITO_CLIENT_ID: localClient.clientId,
    COGNITO_CLIENT_SECRET: localClient.clientSecret,
    COGNITO_ISSUER,
    COGNITO_DOMAIN,
    COGNITO_REGION: 'ap-northeast-1',
    TACHYON_API_URL: options.apiUrl,
    AUTH_BACKEND_API_URL: options.apiUrl,
    TACHYON_FIELD_API_URL: FIELD_API_URL,
    BACKEND_API_URL: FIELD_API_URL,
    // Auth.js BFF proxies /v1/course/* to local Rust course-api.
    COURSEBOARD_API_URL: LOCAL_COURSE_API_URL,
  })
  // Real Cognito user JWTs from Auth.js must be verified via OIDC, not the
  // static COURSEBOARD_DEV_BEARER_TOKEN bypass used by `npm run field:env`.
  const apiPath = writeEnvFile(
    options.apiEnvFile,
    {
      DATABASE_URL: 'sqlite:///tmp/courseboard-local.db',
      COURSEBOARD_PUBLIC_UI_BASE_URL: 'http://127.0.0.1:8080/ui/index.html',
      TACHYON_FIELD_API_URL: FIELD_API_URL,
      OIDC_ISSUER_URL: COGNITO_ISSUER,
      // Cognito access tokens use client_id as audience for this confidential client.
      EXPECTED_AUDIENCE: localClient.clientId,
    },
    COURSE_API_STATIC_BEARER_KEYS,
  )

  console.log(`Configured ${uiPath}`)
  console.log(`Configured ${webHostPath}`)
  console.log(`Configured ${apiPath}`)
  console.log(`OAuth client: ${options.clientName} (${localClient.clientId})`)
  console.log(`OAuth client action: ${localClient.action}`)
  console.log('Auth mode: web-session through the local Auth.js BFF.')
  console.log('Client secret was not printed and is stored only in the ignored 0600 web-host env file.')
  console.log(
    'Start course-api with: set -a && source .env.web-session && set +a && export COURSEBOARD_DEV_BEARER_TOKEN= && cargo run',
  )
  console.log(
    'If course-api still logs the static bearer verifier, comment out COURSEBOARD_DEV_BEARER_TOKEN in the repo-root .env (dotenvy loads it).',
  )
  console.log('Then: cd desktop/web-host && pnpm dev')
  console.log('Then: cd desktop && npm run dev -- --host 127.0.0.1')
  console.log('Open: http://127.0.0.1:5173 and sign in with a Tachyon Cognito test user.')
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined
if (entrypoint === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
