#!/usr/bin/env node

/**
 * Configure local CourseBoard env files.
 *
 * Usage:
 *   node scripts/configure.mjs <pkce|field|prod-api|prod-api-pkce> [options]
 *
 * npm aliases: pkce:env / field:env / prod-api:env / prod-api:pkce-env
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  activeProfile,
  authHeaders,
  hasRequiredValues,
  jwtClaims,
  jwtExpirySeconds,
  parseEnvFile,
  parseFlagArgs,
  profileCredentials,
  readEnvFile,
  refreshCliProfile,
  requestJson,
  tachyonConfigDirectory,
  updateEnvContent,
  writeEnvFile,
} from './lib.mjs'

export { parseEnvFile, updateEnvContent } from './lib.mjs'

const COMMANDS = ['pkce', 'field', 'prod-api', 'prod-api-pkce']

function topUsage() {
  console.log(`Usage: node scripts/configure.mjs <command> [options]

Commands:
  pkce            Cognito public client + .env.browser-pkce (preferred for local :8080)
  field           CLI JWT shortcut → .env.prod-field + desktop/.env.local
  prod-api        Vite overlay → production courseboard-api (.env.prod-api.local)
                  --login password (real user) | --login cli (Local operator JWT)
  prod-api-pkce   Alias for: prod-api --login password

npm aliases:
  npm run pkce:env | field:env | prod-api:env | prod-api:pkce-env
  npm run configure -- <command> [options]

Pass --help after a command for command-specific options.`)
}


const BROWSER_PKCE_ENV_KEYS = [
  'VITE_COURSEBOARD_BROWSER_CLIENT_ID',
  'VITE_COURSEBOARD_COGNITO_REGION',
  'VITE_COURSEBOARD_BROWSER_REDIRECT_URI',
  'VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT',
  'VITE_COURSEBOARD_BROWSER_SCOPES',
]
/**
 * Empty-string overrides for development / prod-api UI env files.
 *
 * Vite loads `.env.local` in every mode and only lets `.env.[mode].local`
 * win for keys that are present. Removing browser-pkce keys from an overlay
 * leaves stale auth values from `.env.local`; write `KEY=` so the overlay wins.
 */
export function developmentUiClearValues(extraKeys = []) {
  const cleared = {
    // Remove stale values from pre-React/Auth.js local environments.
    VITE_AUTH_PROXY_TARGET: '',
  }
  for (const key of BROWSER_PKCE_ENV_KEYS) cleared[key] = ''
  for (const key of extraKeys) cleared[key] = ''
  return cleared
}

// ---------------------------------------------------------------------------
// pkce — browser-pkce + prod Field
// ---------------------------------------------------------------------------

const LOCAL_PKCE_REDIRECT_URI = 'http://127.0.0.1:5173/oauth/callback'
const PKCE_FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'
const PKCE_REQUIRED_SCOPES = ['openid', 'profile', 'email']
// authorization_code is provisioning compatibility for clients that retain
// redirect/scopes. The React/Tauri runtime uses only Cognito direct auth.
const PKCE_REQUIRED_GRANT_TYPES = ['authorization_code', 'password', 'refresh_token']
export const PRODUCTION_COGNITO_REGION = 'ap-northeast-1'
export const PRODUCTION_COGNITO_ISSUER =
  'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_8Ga4bK5M4'
const AUTHJS_UI_ENV_KEYS = [
  'VITE_AUTH_PROXY_TARGET',
  'VITE_COURSEBOARD_API_BEARER',
]
const PKCE_COURSE_API_STATIC_BEARER_KEYS = [
  'COURSEBOARD_DEV_BEARER_TOKEN',
  'TACHYON_FIELD_API_BEARER_TOKEN',
]

const pkceDefaults = {
  apiUrl: 'https://api.n1.tachy.one',
  callbackUrl: LOCAL_PKCE_REDIRECT_URI,
  clientName: 'courseboard-local-pkce',
  tenantId: 'tn_01kxd5gdvm9thcbj8c2e8c6yhq',
  uiEnvFile: '.env.local',
  apiEnvFile: '../.env.browser-pkce',
}

function pkceUsage() {
  console.log(`Usage: npm run pkce:env -- [options]
       node scripts/configure.mjs pkce [options]

Configure local Vite for direct Cognito password/refresh auth and course-api
OIDC verification against production Field (inbound login bearer).

Options:
  --profile <name>        Tachyon CLI profile (default: active profile)
  --tenant-id <id>        Default tn_… tenant for x-operator-id
  --client-name <name>    Public OAuth client name (default: courseboard-local-pkce)
  --ui-env-file <path>    Vite env file (default: .env.local)
  --api-env-file <path>   course-api env file (default: ../.env.browser-pkce)
  --callback-url <url>    Provisioning-only redirect URI (direct auth does not redirect)
  --api-url <url>         Tachyon API base URL
  --dry-run               Validate and report without creating or writing
  --help                  Show this help`)
}

export function parsePkceArgs(argv, environment = process.env) {
  return parseFlagArgs(
    argv,
    {
      ...pkceDefaults,
      profile: environment.TACHYON_PROFILE,
      tenantId: environment.TACHYON_TENANT_ID || pkceDefaults.tenantId,
    },
    new Map([
      ['--profile', 'profile'],
      ['--tenant-id', 'tenantId'],
      ['--client-name', 'clientName'],
      ['--ui-env-file', 'uiEnvFile'],
      ['--api-env-file', 'apiEnvFile'],
      ['--callback-url', 'callbackUrl'],
      ['--api-url', 'apiUrl'],
    ]),
  )
}

async function listPkceClients({ accessToken, apiUrl, tenantId }) {
  return requestJson(
    `${apiUrl.replace(/\/$/, '')}/v1/auth/oauth2-clients`,
    { headers: authHeaders(accessToken, tenantId) },
    'List OAuth clients',
  )
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
        allowedScopes: PKCE_REQUIRED_SCOPES,
        grantTypes: PKCE_REQUIRED_GRANT_TYPES,
        useTachyonUserPool: true,
        clientType: 'public',
      }),
    },
    'Create local Cognito public client',
  )
}

async function updatePkceClient({ accessToken, apiUrl, callbackUrl, client, tenantId }) {
  const redirectUris = [...new Set([...client.redirectUris, callbackUrl])]
  const allowedScopes = [...new Set([...client.allowedScopes, ...PKCE_REQUIRED_SCOPES])]
  const grantTypes = [...new Set([...(client.grantTypes ?? []), ...PKCE_REQUIRED_GRANT_TYPES])]
  return requestJson(
    `${apiUrl.replace(/\/$/, '')}/v1/auth/oauth2-clients/${client.id}`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken, tenantId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ redirectUris, allowedScopes, grantTypes }),
    },
    'Update local Cognito public client',
  )
}

export async function ensurePublicClient(options, accessToken) {
  const payload = await listPkceClients({
    accessToken,
    apiUrl: options.apiUrl,
    tenantId: options.ownerTenantId,
  })
  const clients = Array.isArray(payload.clients) ? payload.clients : []
  const matches = clients.filter(client =>
    client?.name === options.clientName && client?.status === 'active',
  )
  if (matches.length > 1) {
    throw new Error(`Multiple active OAuth clients named '${options.clientName}'.`)
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
      throw new Error('Tachyon did not return a local Cognito public client id.')
    }
    if (created.clientSecret) {
      throw new Error('Public client unexpectedly returned a client secret. Check clientType=public.')
    }
    return { action: 'created', clientId: created.clientId }
  }

  let client = matches[0]
  if (!client.useTachyonUserPool) {
    throw new Error(`OAuth client '${options.clientName}' does not use Tachyon User Pool.`)
  }
  const needsUpdate = !client.redirectUris?.includes(options.callbackUrl)
    || !hasRequiredValues(client.grantTypes ?? [], PKCE_REQUIRED_GRANT_TYPES)
  if (needsUpdate) {
    if (options.dryRun) {
      return { action: 'update', clientId: client.clientId }
    }
    client = await updatePkceClient({
      accessToken,
      apiUrl: options.apiUrl,
      callbackUrl: options.callbackUrl,
      client,
      tenantId: options.ownerTenantId,
    })
  }
  return { action: 'reused', clientId: client.clientId }
}

export async function runPkce(argv = []) {
  const options = parsePkceArgs(argv)
  if (options.help) {
    pkceUsage()
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

  const ownerTenantId = 'tn_01ks18jhh1xvggktfzjx5jqsen'
  const localClient = await ensurePublicClient(
    { ...options, ownerTenantId },
    credentials.access_token,
  )

  if (options.dryRun) {
    console.log(`Validated Tachyon profile '${profile}'.`)
    console.log(`Local Cognito public client action: ${localClient.action}.`)
    console.log(`Would configure ${options.uiEnvFile} and ${options.apiEnvFile}.`)
    return
  }

  const uiPath = writeEnvFile(
    options.uiEnvFile,
    {
      VITE_COURSEBOARD_AUTH_MODE: 'cognito-direct',
      VITE_COURSEBOARD_BROWSER_CLIENT_ID: localClient.clientId,
      VITE_COURSEBOARD_COGNITO_REGION: PRODUCTION_COGNITO_REGION,
      VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT: '/v1/me',
      VITE_COURSEBOARD_TENANT_ID: options.tenantId,
      VITE_COURSEBOARD_OPERATOR_ID: options.tenantId,
      VITE_COURSEBOARD_MOCK_DATA: 'false',
      VITE_COURSEBOARD_MODE: 'production',
      VITE_DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080',
    },
    AUTHJS_UI_ENV_KEYS,
  )

  const apiPath = writeEnvFile(
    options.apiEnvFile,
    {
      DATABASE_URL: 'sqlite:///tmp/courseboard-local.db',
      COURSEBOARD_PUBLIC_UI_BASE_URL: 'http://127.0.0.1:8080/ui/index.html',
      TACHYON_FIELD_API_URL: PKCE_FIELD_API_URL,
      OIDC_ISSUER_URL: PRODUCTION_COGNITO_ISSUER,
      EXPECTED_AUDIENCE: localClient.clientId,
      EXPECTED_CLIENT_ID: localClient.clientId,
    },
    PKCE_COURSE_API_STATIC_BEARER_KEYS,
  )

  console.log(`Configured ${uiPath}`)
  console.log(`Configured ${apiPath}`)
  console.log(`OAuth public client: ${options.clientName} (${localClient.clientId})`)
  console.log(`OAuth client action: ${localClient.action}`)
  console.log(`Default tenant (x-operator-id): ${options.tenantId}`)
  console.log('Auth mode: cognito-direct (React USER_PASSWORD_AUTH). No Auth.js or Hosted UI.')
  console.log('')
  console.log('Start course-api (terminal 1):')
  console.log('  mise run courseboard:api')
  console.log('')
  console.log('Start Vite (terminal 2):')
  console.log('  mise run courseboard:vite')
  console.log('')
  console.log('Open: http://127.0.0.1:5173')
  console.log('Sign in with a Tachyon User Pool username/password (same as platform-ui).')
  console.log(
    'If course-api still logs the static bearer verifier, comment out COURSEBOARD_DEV_BEARER_TOKEN in the repo-root .env (dotenvy loads it).',
  )
  console.log(
    'Outbound Field calls use the Cognito login bearer (same token as course-api OIDC). Refresh is handled directly with Cognito.',
  )
}

// ---------------------------------------------------------------------------
// field — CLI JWT + prod Field
// ---------------------------------------------------------------------------

const PROD_FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'

const fieldDefaults = {
  apiEnvFile: '../.env.prod-field',
  fieldApiUrl: PROD_FIELD_API_URL,
  uiEnvFile: '.env.local',
}

function fieldUsage() {
  console.log(`Usage: npm run field:env -- [options]
       node scripts/configure.mjs field [options]

Write gitignored env files so local course-api (:8080) and Vite (:5173) talk to
production Field API (${PROD_FIELD_API_URL}).

Options:
  --profile <name>       Tachyon CLI profile (default: active profile)
  --tenant-id <id>       x-operator-id / tenant (must be tn_… for prod Field)
  --field-api-url <url>  Field API base URL (default: production)
  --ui-env-file <path>   Vite env file (default: .env.local)
  --api-env-file <path>  course-api env file (default: ../.env.prod-field)
  --dry-run              Validate and report without writing files
  --help                 Show this help`)
}

export function parseFieldArgs(argv, environment = process.env) {
  return parseFlagArgs(
    argv,
    {
      ...fieldDefaults,
      profile: environment.TACHYON_PROFILE,
      tenantId: environment.TACHYON_TENANT_ID || '',
    },
    new Map([
      ['--profile', 'profile'],
      ['--tenant-id', 'tenantId'],
      ['--field-api-url', 'fieldApiUrl'],
      ['--ui-env-file', 'uiEnvFile'],
      ['--api-env-file', 'apiEnvFile'],
    ]),
  )
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

export async function runField(argv = []) {
  const options = parseFieldArgs(argv)
  if (options.help) {
    fieldUsage()
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

  const apiPath = writeEnvFile(options.apiEnvFile, {
    COURSEBOARD_DEV_BEARER_TOKEN: credentials.access_token,
    DATABASE_URL: 'sqlite:///tmp/courseboard-local.db',
    COURSEBOARD_PUBLIC_UI_BASE_URL: 'http://127.0.0.1:8080/ui/index.html',
    TACHYON_FIELD_API_URL: options.fieldApiUrl,
  })

  const uiPath = writeEnvFile(options.uiEnvFile, {
    VITE_COURSEBOARD_AUTH_MODE: 'development',
    VITE_COURSEBOARD_API_BEARER: credentials.access_token,
    VITE_COURSEBOARD_TENANT_ID: tenantId,
    VITE_COURSEBOARD_OPERATOR_ID: tenantId,
    VITE_COURSEBOARD_MOCK_DATA: 'false',
    VITE_COURSEBOARD_MODE: 'production',
    VITE_DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080',
    // Empty overrides (not removals) so leftover browser-pkce keys cannot win.
    ...developmentUiClearValues(),
  })

  console.log(`Configured ${apiPath}`)
  console.log(`Configured ${uiPath}`)
  console.log(`Profile: ${profile}`)
  console.log(`Field URL: ${options.fieldApiUrl}`)
  console.log(`Tenant (x-operator-id): ${tenantId}`)
  console.log(`Field courses visible to this token: ${courseCount}`)
  console.log(`Token expires in: ${expiresIn ?? 'unknown'}s`)
  console.log('')
  console.log('Start course-api (terminal 1):')
  console.log('  mise run courseboard:field-api')
  console.log('')
  console.log('Start Vite (terminal 2):')
  console.log('  mise run courseboard:field-vite')
  console.log('')
  console.log('Open: http://127.0.0.1:5173/#/golf/timeline')
  console.log('Re-run npm run field:env when the JWT expires (~1h).')
}

// ---------------------------------------------------------------------------
// prod-api — Vite → production courseboard-api
// ---------------------------------------------------------------------------

export const PROD_COURSEBOARD_API_URL = 'https://courseboard-api.txcloud.app'
/** Deployed Cognito public client / prod Lambda EXPECTED_AUDIENCE. */
export const PROD_API_EXPECTED_AUDIENCE = '5oafg9ptonbjumdh1pc7khirp1'
export const PROD_API_PUBLIC_CLIENT_NAME = 'courseboard-local-prod-pkce'
export const PROD_API_LOGIN_MODES = ['cli', 'password']
const PROD_API_FIELD_URL = 'https://tachyon-field-api.txcloud.app'
const PROD_API_OWNER_TENANT_ID = 'tn_01ks18jhh1xvggktfzjx5jqsen'

const prodApiDefaults = {
  apiUrl: 'https://api.n1.tachy.one',
  courseApiUrl: PROD_COURSEBOARD_API_URL,
  fieldApiUrl: PROD_API_FIELD_URL,
  uiEnvFile: '.env.prod-api.local',
  login: 'cli',
  clientName: PROD_API_PUBLIC_CLIENT_NAME,
  callbackUrl: LOCAL_PKCE_REDIRECT_URI,
}

function prodApiUsage() {
  console.log(`Usage: npm run prod-api:env -- [options]
       npm run prod-api:pkce-env -- [options]
       node scripts/configure.mjs prod-api [options]
       node scripts/configure.mjs prod-api-pkce [options]

Write gitignored desktop/.env.prod-api.local so Vite (--mode prod-api) calls
production courseboard-api directly
(${PROD_COURSEBOARD_API_URL}).

Does NOT modify desktop/.env.local (Cognito-direct / local :8080 stays intact).

Login modes (--login):
  password  React password form + direct Cognito auth (real user; AUTH_MODE=cognito-direct). Preferred.
            Alias: npm run prod-api:pkce-env / configure prod-api-pkce
  cli       DevelopmentAdapter + Tachyon CLI Cognito JWT (shows "Local operator").

Options:
  --login <cli|password>   Auth path (default: cli for backwards compatibility)
  --profile <name>         Tachyon CLI profile (default: active profile)
  --tenant-id <id>         x-operator-id / tenant fallback (must be tn_…)
  --client-name <name>     Public OAuth client for password login (default: ${PROD_API_PUBLIC_CLIENT_NAME})
  --callback-url <url>     Provisioning-only redirect URI (default: ${LOCAL_PKCE_REDIRECT_URI})
  --api-url <url>          Tachyon API base for OAuth client registration (default: api.n1)
  --course-api-url <url>   CourseBoard API base (default: production)
  --field-api-url <url>    Field smoke URL only (default: production Field; cli mode)
  --ui-env-file <path>     Overlay env file (default: .env.prod-api.local)
  --dry-run                Validate and report without writing files
  --help                   Show this help`)
}

export function parseProdApiArgs(argv, environment = process.env) {
  const options = parseFlagArgs(
    argv,
    {
      ...prodApiDefaults,
      profile: environment.TACHYON_PROFILE,
      tenantId: environment.TACHYON_TENANT_ID || '',
    },
    new Map([
      ['--login', 'login'],
      ['--profile', 'profile'],
      ['--tenant-id', 'tenantId'],
      ['--client-name', 'clientName'],
      ['--callback-url', 'callbackUrl'],
      ['--api-url', 'apiUrl'],
      ['--course-api-url', 'courseApiUrl'],
      ['--field-api-url', 'fieldApiUrl'],
      ['--ui-env-file', 'uiEnvFile'],
    ]),
  )
  const login = String(options.login || 'cli').trim().toLowerCase()
  if (!PROD_API_LOGIN_MODES.includes(login)) {
    throw new Error(`--login must be one of: ${PROD_API_LOGIN_MODES.join(', ')} (got '${options.login}')`)
  }
  options.login = login
  return options
}

/** Overlay values for direct Cognito auth → prod courseboard-api. */
export function browserPkceProdApiUiValues({
  clientId,
  courseApiUrl,
  tenantId,
}) {
  const apiBase = courseApiUrl.replace(/\/$/, '')
  return {
    VITE_COURSEBOARD_AUTH_MODE: 'cognito-direct',
    VITE_COURSEBOARD_BROWSER_CLIENT_ID: clientId,
    VITE_COURSEBOARD_COGNITO_REGION: PRODUCTION_COGNITO_REGION,
    VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT: `${apiBase}/v1/me`,
    VITE_COURSEBOARD_API_BEARER: '',
    VITE_COURSEBOARD_API_BASE_URL: apiBase,
    VITE_COURSEBOARD_TENANT_ID: tenantId,
    VITE_COURSEBOARD_OPERATOR_ID: tenantId,
    VITE_COURSEBOARD_MOCK_DATA: 'false',
    VITE_COURSEBOARD_MODE: 'production',
    VITE_DEV_API_PROXY_TARGET: '',
  }
}

async function smokeCourseApi(courseApiUrl, accessToken, tenantId) {
  const url = `${courseApiUrl.replace(/\/$/, '')}/v1/course/courses`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-operator-id': tenantId,
    },
  })
  const body = await response.text()
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `course-api auth smoke failed HTTP ${response.status} for tenant ${tenantId}: ${body.slice(0, 240)}`,
    )
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      detail: body.slice(0, 240),
      courseCount: null,
    }
  }
  let courseCount = '?'
  try {
    const data = JSON.parse(body)
    if (Array.isArray(data?.items)) courseCount = data.items.length
  } catch {
    courseCount = '?'
  }
  return { ok: true, status: response.status, detail: '', courseCount }
}

async function smokeHealthz(courseApiUrl) {
  const url = `${courseApiUrl.replace(/\/$/, '')}/healthz`
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`healthz failed HTTP ${response.status} for ${url}`)
  }
}

async function runProdApiCli(options, profile, credentials, tenantId) {
  const expiresIn = jwtExpirySeconds(credentials.access_token)
  if (expiresIn !== null && expiresIn < 60) {
    throw new Error(
      `Access token for profile '${profile}' is expired or about to expire. Run: tachyon auth login --profile ${profile}`,
    )
  }

  const claims = jwtClaims(credentials.access_token)
  const issuer = typeof claims.iss === 'string' ? claims.iss : ''
  if (!issuer.includes('cognito-idp')) {
    console.warn(
      `Warning: CLI token iss is not Cognito (${issuer || 'missing'}). `
        + 'Production courseboard-api currently expects Cognito; auth may fail.',
    )
  }

  if (options.dryRun) {
    console.log(`Validated Tachyon profile '${profile}'.`)
    console.log(`Login mode: cli (Local operator / DevelopmentAdapter)`)
    console.log(`Course API: ${options.courseApiUrl}`)
    console.log(`Field smoke URL: ${options.fieldApiUrl}`)
    console.log(`Tenant (x-operator-id): ${tenantId}`)
    console.log(`Token expires in: ${expiresIn ?? 'unknown'}s`)
    console.log(`Would write ${options.uiEnvFile} (leaves .env.local untouched)`)
    return
  }

  await smokeHealthz(options.courseApiUrl)
  const courseSmoke = await smokeCourseApi(
    options.courseApiUrl,
    credentials.access_token,
    tenantId,
  )

  // Write empty browser-pkce / Auth.js keys so `.env.prod-api.local` overrides
  // leftover values from `.env.local` (Vite: mode.local > .env.local only when set).
  const uiPath = writeEnvFile(options.uiEnvFile, {
    VITE_COURSEBOARD_AUTH_MODE: 'development',
    VITE_COURSEBOARD_API_BEARER: credentials.access_token,
    VITE_COURSEBOARD_TENANT_ID: tenantId,
    VITE_COURSEBOARD_OPERATOR_ID: tenantId,
    VITE_COURSEBOARD_MOCK_DATA: 'false',
    VITE_COURSEBOARD_MODE: 'production',
    VITE_COURSEBOARD_API_BASE_URL: options.courseApiUrl.replace(/\/$/, ''),
    VITE_DEV_API_PROXY_TARGET: '',
    ...developmentUiClearValues(),
  })

  console.log(`Configured ${uiPath}`)
  console.log(`Profile: ${profile}`)
  console.log(`Login mode: cli (shows "Local operator")`)
  console.log(`Course API target: ${options.courseApiUrl}`)
  console.log(`Tenant (x-operator-id): ${tenantId}`)
  if (courseSmoke.ok) {
    console.log(`Prod /v1/course/courses items visible: ${courseSmoke.courseCount}`)
  } else {
    console.log(
      `Prod /v1/course/courses smoke: HTTP ${courseSmoke.status} (overlay written anyway)`,
    )
    if (courseSmoke.detail) console.log(`  detail: ${courseSmoke.detail}`)
    console.log(
      '  Tip: /healthz can be OK while /v1/course/* 502s if Lambda/Field upstream is broken.',
    )
  }
  console.log(`Token expires in: ${expiresIn ?? 'unknown'}s`)
  console.log('')
  console.log('desktop/.env.local was NOT modified (Cognito-direct / :8080 config kept).')
  console.log('')
  console.log('Restart Vite yourself (agents will not kill :5173):')
  console.log('  mise run courseboard:vite-prod-api')
  console.log('  # or: cd desktop && npm run prod-api:vite')
  console.log('')
  console.log('Open: http://127.0.0.1:5173/#/golf/timeline')
  console.log('Re-run npm run prod-api:env when the Cognito JWT expires (~1h).')
  console.log('')
  console.log('For real-user React password login instead of Local operator:')
  console.log('  npm run prod-api:pkce-env')
  console.log('')
  console.log('Auth notes:')
  console.log('- Uses AUTH_MODE=development + CLI Cognito bearer (Local operator).')
  console.log('- Prod course-api Field upstream is production Field (deployed config).')
  console.log('- Browser requests courseboard-api directly; local origin must pass API CORS.')
}

async function runProdApiPassword(options, profile, credentials, tenantId) {
  const callback = new URL(options.callbackUrl)
  if (
    callback.protocol !== 'http:'
    || callback.hostname !== '127.0.0.1'
    || callback.port !== '5173'
    || callback.pathname !== '/oauth/callback'
  ) {
    throw new Error(`--callback-url must be ${LOCAL_PKCE_REDIRECT_URI}`)
  }

  const localClient = await ensurePublicClient(
    { ...options, ownerTenantId: PROD_API_OWNER_TENANT_ID },
    credentials.access_token,
  )

  if (options.dryRun) {
    console.log(`Validated Tachyon profile '${profile}'.`)
    console.log(`Login mode: password (React form + direct Cognito; not Local operator)`)
    console.log(`Course API: ${options.courseApiUrl}`)
    console.log(`Public client action: ${localClient.action}`)
    console.log(`Tenant fallback (x-operator-id): ${tenantId}`)
    console.log(`Would write ${options.uiEnvFile} (leaves .env.local untouched)`)
    return
  }

  await smokeHealthz(options.courseApiUrl)

  const uiPath = writeEnvFile(
    options.uiEnvFile,
    browserPkceProdApiUiValues({
      clientId: localClient.clientId,
      callbackUrl: options.callbackUrl,
      courseApiUrl: options.courseApiUrl,
      tenantId,
    }),
  )

  console.log(`Configured ${uiPath}`)
  console.log(`Profile: ${profile}`)
  console.log(`Login mode: cognito-direct (React password form; real user)`)
  console.log(`Course API proxy target: ${options.courseApiUrl}`)
  console.log(`OAuth public client: ${options.clientName} (${localClient.clientId})`)
  console.log(`OAuth client action: ${localClient.action}`)
  console.log(`Tenant fallback (x-operator-id): ${tenantId}`)
  console.log('')
  console.log('desktop/.env.local was NOT modified (browser-pkce / :8080 config kept).')
  console.log('')
  console.log('Restart Vite yourself (agents will not kill :5173):')
  console.log('  mise run courseboard:vite-prod-api')
  console.log('  # or: cd desktop && npm run prod-api:vite')
  console.log('')
  console.log('Open: http://127.0.0.1:5173')
  console.log('Enter the Tachyon User Pool username/password in the React form.')
  console.log('You should see your real user name — not "Local operator".')
  console.log('')
  console.log('=== Required once: configure prod courseboard-api for this public client ===')
  console.log(`1. Set OIDC_ISSUER_URL=${PRODUCTION_COGNITO_ISSUER}.`)
  console.log(`2. Set EXPECTED_AUDIENCE and EXPECTED_CLIENT_ID to ${localClient.clientId}.`)
  console.log('3. Redeploy courseboard-api so Lambda picks up the verifier configuration.')
  console.log('4. Ensure the public Cognito client allows USER_PASSWORD_AUTH and REFRESH_TOKEN_AUTH.')
  console.log('')
  console.log('Auth notes:')
  console.log('- AUTH_MODE=cognito-direct; VITE_COURSEBOARD_API_BEARER is cleared.')
  console.log(`- Tokens use the Cognito issuer (${PRODUCTION_COGNITO_ISSUER}).`)
  console.log('- Cognito Hosted UI is not used.')
  console.log('- Browser requests courseboard-api directly; production/local origins must pass API CORS.')
}

export async function runProdApi(argv = []) {
  const options = parseProdApiArgs(argv)
  if (options.help) {
    prodApiUsage()
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
      `Prod course-api / Field require tenant ids that start with tn_ (got '${tenantId}').`,
    )
  }

  if (options.login === 'password') {
    return runProdApiPassword(options, profile, credentials, tenantId)
  }
  return runProdApiCli(options, profile, credentials, tenantId)
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') {
    topUsage()
    if (!command) process.exitCode = 2
    return
  }
  if (!COMMANDS.includes(command)) {
    throw new Error(`Unknown command '${command}'. Expected one of: ${COMMANDS.join(', ')}`)
  }
  if (command === 'pkce') return runPkce(rest)
  if (command === 'field') return runField(rest)
  if (command === 'prod-api') return runProdApi(rest)
  if (command === 'prod-api-pkce') return runProdApi(['--login', 'password', ...rest])
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
