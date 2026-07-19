#!/usr/bin/env node

/**
 * Wire local course-api + Vite desktop to production Field API.
 *
 * Reads a Tachyon CLI profile access token (refreshing via CLI when possible),
 * writes gitignored env files, and prints the exact start commands.
 *
 * Never prints the bearer token.
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

const PROD_FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'

const defaults = {
  apiEnvFile: '../.env.prod-field',
  fieldApiUrl: PROD_FIELD_API_URL,
  uiEnvFile: '.env.local',
}

export function parseArgs(argv, environment = process.env) {
  const options = {
    ...defaults,
    dryRun: false,
    profile: environment.TACHYON_PROFILE,
    tenantId: environment.TACHYON_TENANT_ID || '',
  }
  const valueOptions = new Map([
    ['--profile', 'profile'],
    ['--tenant-id', 'tenantId'],
    ['--field-api-url', 'fieldApiUrl'],
    ['--ui-env-file', 'uiEnvFile'],
    ['--api-env-file', 'apiEnvFile'],
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

function usage() {
  console.log(`Usage: npm run field:env -- [options]

Write gitignored env files so local course-api (:8080) and Vite (:5173) talk to
production Field API (${PROD_FIELD_API_URL}).

Local course-api always targets Field (default production URL). course-api
forwards the inbound Authorization + x-operator-id to Field, so the
dev bearer must be a real Tachyon JWT (not local-dev-token).

Options:
  --profile <name>       Tachyon CLI profile (default: active profile)
  --tenant-id <id>       x-operator-id / tenant (must be tn_… for prod Field)
  --field-api-url <url>  Field API base URL (default: production)
  --ui-env-file <path>   Vite env file (default: .env.local)
  --api-env-file <path>  course-api env file (default: ../.env.prod-field)
  --dry-run              Validate and report without writing files
  --help                 Show this help`)
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
    throw new Error('Tachyon CLI not found. Install tachyon first.')
  }
  if (result.status !== 0) {
    throw new Error(
      `Unable to refresh Tachyon profile '${profile}'. Run: tachyon auth login --profile ${profile}`,
    )
  }
}

function profileCredentials(configDirectory, profile) {
  const profileFile = join(configDirectory, 'profiles', `${profile}.json`)
  const legacyFile = join(configDirectory, 'credentials.json')
  const credentialsFile = existsSync(profileFile) ? profileFile : legacyFile
  if (!existsSync(credentialsFile)) {
    throw new Error(
      `Tachyon profile '${profile}' is missing. Run: tachyon auth login --profile ${profile}`,
    )
  }
  const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'))
  if (typeof credentials.access_token !== 'string' || !credentials.access_token) {
    throw new Error(`Tachyon profile '${profile}' has no access_token.`)
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
    updated.push('# Managed by npm run field:env. Do not commit.')
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

function jwtExpirySeconds(accessToken) {
  const parts = accessToken.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    )
    if (typeof payload.exp !== 'number') return null
    return payload.exp - Math.floor(Date.now() / 1000)
  } catch {
    return null
  }
}

async function smokeFieldApi(fieldApiUrl, accessToken, tenantId) {
  const url = `${fieldApiUrl.replace(/\/$/, '')}/v1/erp/extensions/golf-course/courses`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-operator-id': tenantId,
    },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Field smoke failed HTTP ${response.status} for tenant ${tenantId}: ${body.slice(0, 240)}`,
    )
  }
  const data = await response.json()
  return Array.isArray(data?.items) ? data.items.length : '?'
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }

  const configDirectory = tachyonConfigDirectory()
  const profile = activeProfile(configDirectory, options.profile)
  refreshCliProfile(profile)
  const credentials = profileCredentials(configDirectory, profile)
  const tenantId = (options.tenantId || credentials.operator_id || '').trim()
  if (!tenantId) {
    throw new Error('No tenant id. Pass --tenant-id tn_… or login with an operator-bound profile.')
  }
  if (!tenantId.startsWith('tn_')) {
    throw new Error(
      `Prod Field requires tenant ids that start with tn_ (got '${tenantId}'). Local demo ids like 'courseboard_id' are not accepted.`,
    )
  }

  const expiresIn = jwtExpirySeconds(credentials.access_token)
  if (expiresIn !== null && expiresIn < 60) {
    throw new Error(
      `Access token for profile '${profile}' is expired or about to expire. Run: tachyon auth login --profile ${profile}`,
    )
  }

  if (options.dryRun) {
    console.log(`Validated Tachyon profile '${profile}'.`)
    console.log(`Field URL: ${options.fieldApiUrl}`)
    console.log(`Tenant (x-operator-id): ${tenantId}`)
    console.log(`Token expires in: ${expiresIn ?? 'unknown'}s`)
    console.log(`Would write ${options.uiEnvFile} and ${options.apiEnvFile}`)
    return
  }

  const courseCount = await smokeFieldApi(
    options.fieldApiUrl,
    credentials.access_token,
    tenantId,
  )

  // COURSEBOARD_DEV_BEARER_TOKEN must equal the JWT Vite sends, because
  // course-api forwards that Authorization header to Field.
  const apiPath = writeEnvFile(options.apiEnvFile, {
    COURSEBOARD_DEV_BEARER_TOKEN: credentials.access_token,
    DATABASE_URL: 'sqlite:///tmp/courseboard-local.db',
    COURSEBOARD_PUBLIC_UI_BASE_URL: 'http://127.0.0.1:8080/ui/index.html',
    TACHYON_FIELD_API_URL: options.fieldApiUrl,
  })

  const uiPath = writeEnvFile(
    options.uiEnvFile,
    {
      VITE_COURSEBOARD_AUTH_MODE: 'development',
      VITE_COURSEBOARD_API_BEARER: credentials.access_token,
      VITE_COURSEBOARD_TENANT_ID: tenantId,
      VITE_COURSEBOARD_OPERATOR_ID: tenantId,
      VITE_COURSEBOARD_MOCK_DATA: 'false',
      VITE_COURSEBOARD_MODE: 'production',
      VITE_DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080',
    },
    [
      'VITE_AUTH_PROXY_TARGET',
      'VITE_COURSEBOARD_BROWSER_CLIENT_ID',
      'VITE_COURSEBOARD_BROWSER_REDIRECT_URI',
      'VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT',
      'VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT',
      'VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT',
      'VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT',
      'VITE_COURSEBOARD_BROWSER_SCOPES',
    ],
  )

  console.log(`Configured ${apiPath}`)
  console.log(`Configured ${uiPath}`)
  console.log(`Profile: ${profile}`)
  console.log(`Field URL: ${options.fieldApiUrl}`)
  console.log(`Tenant (x-operator-id): ${tenantId}`)
  console.log(`Field courses visible to this token: ${courseCount}`)
  console.log(`Token expires in: ${expiresIn ?? 'unknown'}s`)
  console.log('')
  console.log('Start course-api (terminal 1):')
  console.log('  set -a && source .env.prod-field && set +a && cargo run')
  console.log('')
  console.log('Start Vite (terminal 2):')
  console.log('  cd desktop && npm run dev -- --host 127.0.0.1')
  console.log('')
  console.log('Open: http://127.0.0.1:5173/#/golf/timeline')
  console.log('Re-run npm run field:env when the JWT expires (~1h).')
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
