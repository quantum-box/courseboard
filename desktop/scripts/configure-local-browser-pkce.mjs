#!/usr/bin/env node

/**
 * Wire local Vite + course-api for Tachyon JSON PKCE password login
 * (platform-ui style — no Auth.js / Cognito Hosted UI).
 *
 * Flow: POST /oauth2/login → POST /oauth2/authorize (JSON + PKCE)
 *     → POST /oauth2/token → Authorization Bearer on /v1/course/*
 *
 * Writes gitignored env files. Never prints secrets.
 */

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

const LOCAL_PKCE_REDIRECT_URI = 'http://127.0.0.1:5173/oauth/callback'
const FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'
const REQUIRED_SCOPES = ['openid', 'profile', 'email']
const REQUIRED_GRANT_TYPES = ['authorization_code', 'refresh_token']

const AUTHJS_UI_ENV_KEYS = [
  'VITE_AUTH_PROXY_TARGET',
  'VITE_COURSEBOARD_API_BEARER',
]
const COURSE_API_STATIC_BEARER_KEYS = [
  'COURSEBOARD_DEV_BEARER_TOKEN',
  // Dual-token workaround removed: course-api forwards the browser-pkce login
  // bearer to Field. Drop stale CLI Cognito tokens from older pkce:env runs.
  'TACHYON_FIELD_API_BEARER_TOKEN',
]

const defaults = {
  apiUrl: 'https://api.n1.tachy.one',
  callbackUrl: LOCAL_PKCE_REDIRECT_URI,
  clientName: 'courseboard-local-pkce',
  tenantId: 'tn_01kxd5gdvm9thcbj8c2e8c6yhq',
  uiEnvFile: '.env.local',
  apiEnvFile: '../.env.browser-pkce',
}

function usage() {
  console.log(`Usage: npm run pkce:env -- [options]

Configure local Vite for browser-pkce (Tachyon /oauth2/login + JSON PKCE)
and course-api OIDC verification against production Field (inbound login bearer).

Options:
  --profile <name>        Tachyon CLI profile (default: active profile)
  --tenant-id <id>        Default tn_… tenant for x-operator-id
  --client-name <name>    Public OAuth client name (default: courseboard-local-pkce)
  --ui-env-file <path>    Vite env file (default: .env.local)
  --api-env-file <path>   course-api env file (default: ../.env.browser-pkce)
  --callback-url <url>    Registered redirect URI (nominal; JSON authorize does not redirect)
  --api-url <url>         Tachyon API base URL
  --dry-run               Validate and report without creating or writing
  --help                  Show this help`)
}

export function parseArgs(argv, environment = process.env) {
  const options = {
    ...defaults,
    dryRun: false,
    profile: environment.TACHYON_PROFILE,
    tenantId: environment.TACHYON_TENANT_ID || defaults.tenantId,
  }
  const valueOptions = new Map([
    ['--profile', 'profile'],
    ['--tenant-id', 'tenantId'],
    ['--client-name', 'clientName'],
    ['--ui-env-file', 'uiEnvFile'],
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
    updated.push('# Managed by npm run pkce:env. Secrets stay in ignored local files.')
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

async function createPublicClient({ accessToken, apiUrl, callbackUrl, clientName, tenantId }) {
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
        clientType: 'public',
      }),
    },
    'ローカルPKCE public clientを作成',
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
    'ローカルPKCE public clientを更新',
  )
}

export async function ensurePublicClient(options, accessToken) {
  const payload = await listClients({
    accessToken,
    apiUrl: options.apiUrl,
    tenantId: options.ownerTenantId,
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
      return { action: 'create', clientId: undefined }
    }
    const created = await createPublicClient({
      accessToken,
      apiUrl: options.apiUrl,
      callbackUrl: options.callbackUrl,
      clientName: options.clientName,
      tenantId: options.ownerTenantId,
    })
    if (!created.clientId) {
      throw new Error('TachyonがローカルPKCE public client idを返しませんでした。')
    }
    if (created.clientSecret) {
      throw new Error('public clientなのにclient secretが返されました。clientType=publicを確認してください。')
    }
    return { action: 'created', clientId: created.clientId }
  }

  let client = matches[0]
  if (!client.useTachyonUserPool) {
    throw new Error(`OAuth client '${options.clientName}'はTachyon User Poolを使用していません。`)
  }
  if (!hasRequiredValues(client.grantTypes ?? [], ['authorization_code'])) {
    throw new Error(`OAuth client '${options.clientName}'はauthorization_code grantに対応していません。`)
  }
  if (!client.redirectUris?.includes(options.callbackUrl)) {
    if (options.dryRun) {
      return { action: 'update', clientId: client.clientId }
    }
    client = await updateClient({
      accessToken,
      apiUrl: options.apiUrl,
      callbackUrl: options.callbackUrl,
      client,
      tenantId: options.ownerTenantId,
    })
  }
  return { action: 'reused', clientId: client.clientId }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    usage()
    return
  }

  const callback = new URL(options.callbackUrl)
  if (
    callback.protocol !== 'http:'
    || callback.hostname !== '127.0.0.1'
    || callback.port !== '5173'
    || callback.pathname !== '/oauth/callback'
  ) {
    throw new Error(`--callback-url must be ${LOCAL_PKCE_REDIRECT_URI}`)
  }
  if (!String(options.tenantId).startsWith('tn_')) {
    throw new Error(`--tenant-id must start with tn_ (got '${options.tenantId}')`)
  }

  const configDirectory = tachyonConfigDirectory()
  const profile = activeProfile(configDirectory, options.profile)
  refreshCliProfile(profile)
  const credentials = profileCredentials(configDirectory, profile)

  // OAuth clients are owned by the Tachyon Field org that registers them.
  const ownerTenantId = 'tn_01ks18jhh1xvggktfzjx5jqsen'
  const localClient = await ensurePublicClient(
    { ...options, ownerTenantId },
    credentials.access_token,
  )

  if (options.dryRun) {
    console.log(`Validated Tachyon profile '${profile}'.`)
    console.log(`Local PKCE public client action: ${localClient.action}.`)
    console.log(`Would configure ${options.uiEnvFile} and ${options.apiEnvFile}.`)
    return
  }

  const apiBase = options.apiUrl.replace(/\/$/, '')
  const uiPath = writeEnvFile(
    options.uiEnvFile,
    {
      VITE_COURSEBOARD_AUTH_MODE: 'browser-pkce',
      VITE_COURSEBOARD_BROWSER_CLIENT_ID: localClient.clientId,
      VITE_COURSEBOARD_BROWSER_REDIRECT_URI: options.callbackUrl,
      VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT: `${apiBase}/oauth2/login`,
      VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT: `${apiBase}/oauth2/authorize`,
      VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT: `${apiBase}/oauth2/token`,
      VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT: `${apiBase}/v1/me`,
      VITE_COURSEBOARD_BROWSER_SCOPES: REQUIRED_SCOPES.join(' '),
      VITE_COURSEBOARD_TENANT_ID: options.tenantId,
      VITE_COURSEBOARD_OPERATOR_ID: options.tenantId,
      // Prod Field connection: do not inject local demo name/slug chrome.
      VITE_COURSEBOARD_MOCK_DATA: 'false',
      VITE_COURSEBOARD_MODE: 'production',
      VITE_DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080',
    },
    // Drop Auth.js / CLI JWT leftovers so Vite does not keep development
    // bearer login after switching to browser-pkce.
    AUTHJS_UI_ENV_KEYS,
  )

  // course-api verifies the browser-pkce access token (iss=apiUrl) and forwards
  // that same inbound bearer to Field. No CLI Cognito dual-token override.
  const apiPath = writeEnvFile(
    options.apiEnvFile,
    {
      DATABASE_URL: 'sqlite:///tmp/courseboard-local.db',
      COURSEBOARD_PUBLIC_UI_BASE_URL: 'http://127.0.0.1:8080/ui/index.html',
      TACHYON_FIELD_API_URL: FIELD_API_URL,
      // Tachyon /oauth2/token access tokens use iss=<apiUrl> (not Cognito).
      // Discovery: {apiUrl}/.well-known/openid-configuration → oauth2/jwks.
      OIDC_ISSUER_URL: apiBase,
      // Access token aud (and EXPECTED_AUDIENCE) is the public OAuth client id.
      EXPECTED_AUDIENCE: localClient.clientId,
    },
    COURSE_API_STATIC_BEARER_KEYS,
  )

  console.log(`Configured ${uiPath}`)
  console.log(`Configured ${apiPath}`)
  console.log(`OAuth public client: ${options.clientName} (${localClient.clientId})`)
  console.log(`OAuth client action: ${localClient.action}`)
  console.log(`Default tenant (x-operator-id): ${options.tenantId}`)
  console.log('Auth mode: browser-pkce (Tachyon /oauth2/login + JSON PKCE). No Auth.js.')
  console.log(`Nominal redirect URI (must match registration): ${options.callbackUrl}`)
  console.log('')
  console.log('Start course-api (terminal 1):')
  console.log('  mise run courseboard:api')
  console.log('  # or: set -a && source .env.browser-pkce && set +a')
  console.log('  #      export COURSEBOARD_DEV_BEARER_TOKEN= && cargo run')
  console.log('')
  console.log('Start Vite (terminal 2):')
  console.log('  mise run courseboard:vite')
  console.log('  # or: cd desktop && npm run dev -- --host 127.0.0.1 --port 5173')
  console.log('')
  console.log('Open: http://127.0.0.1:5173')
  console.log('Sign in with a Tachyon User Pool username/password (same as platform-ui).')
  console.log(
    'If course-api still logs the static bearer verifier, comment out COURSEBOARD_DEV_BEARER_TOKEN in the repo-root .env (dotenvy loads it).',
  )
  console.log(
    'Outbound Field calls use the browser-pkce login bearer (same token as course-api OIDC). Re-login in the UI when the session expires — no hourly CLI token refresh.',
  )
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
