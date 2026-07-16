#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const defaults = {
  apiUrl: 'https://api.n1.tachy.one',
  clientName: 'courseboard-local-vite',
  envFile: '.env.local',
  tenantId: 'tn_01ks18jhh1xvggktfzjx5jqsen',
}

function usage() {
  console.log(`Usage: npm run auth:env -- [options]

Options:
  --profile <name>       Tachyon CLI profile (default: active profile)
  --tenant-id <id>      OAuth client owner tenant
  --client-name <name>  Public OAuth client name
  --env-file <path>     Output env file (default: .env.local)
  --api-url <url>       Tachyon API base URL
  --dry-run             Fetch and validate without writing
  --help                Show this help`)
}

function parseArgs(argv) {
  const options = { ...defaults, dryRun: false, profile: process.env.TACHYON_PROFILE }
  const valueOptions = new Map([
    ['--profile', 'profile'],
    ['--tenant-id', 'tenantId'],
    ['--client-name', 'clientName'],
    ['--env-file', 'envFile'],
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

async function fetchPublicClient({ accessToken, apiUrl, clientName, tenantId }) {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/auth/oauth2-clients`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-operator-id': tenantId,
    },
  })
  if (!response.ok) {
    throw new Error(`OAuth client一覧を取得できませんでした (HTTP ${response.status})。profileとtenantを確認してください。`)
  }
  const payload = await response.json()
  const clients = Array.isArray(payload.clients) ? payload.clients : []
  const matches = clients.filter(client => client?.name === clientName && client?.status === 'active')
  if (matches.length !== 1) {
    throw new Error(`activeなOAuth client '${clientName}'が1件に確定しませんでした (found: ${matches.length})。`)
  }
  const client = matches[0]
  if (typeof client.clientId !== 'string' || !client.clientId) {
    throw new Error(`OAuth client '${clientName}'にclientIdがありません。`)
  }
  if (!client.redirectUris?.includes('http://127.0.0.1:5173/oauth/callback')) {
    throw new Error(`OAuth client '${clientName}'にローカルcallback URIが登録されていません。`)
  }
  return client
}

function writeEnvFile(filePath, values) {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
  const existing = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
  const lines = existing ? existing.replace(/\n$/, '').split('\n') : []
  const written = new Set()
  const updated = lines.map(line => {
    const separator = line.indexOf('=')
    if (separator <= 0) return line
    const key = line.slice(0, separator)
    if (!(key in values)) return line
    written.add(key)
    return `${key}=${values[key]}`
  })
  const missing = Object.keys(values).filter(key => !written.has(key))
  if (missing.length > 0) {
    if (updated.length > 0 && updated.at(-1) !== '') updated.push('')
    updated.push('# Managed by npm run auth:env (public values only; no client secret).')
    for (const key of missing) updated.push(`${key}=${values[key]}`)
  }

  const temporaryPath = join(dirname(absolutePath), `.${basename(absolutePath)}.tmp`)
  writeFileSync(temporaryPath, `${updated.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, absolutePath)
  chmodSync(absolutePath, 0o600)
  return absolutePath
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
  const client = await fetchPublicClient({
    accessToken: credentials.access_token,
    apiUrl: options.apiUrl,
    clientName: options.clientName,
    tenantId: options.tenantId,
  })

  const values = {
    VITE_COURSEBOARD_AUTH_MODE: 'browser-pkce',
    VITE_COURSEBOARD_BROWSER_CLIENT_ID: client.clientId,
    VITE_COURSEBOARD_BROWSER_REDIRECT_URI: 'http://127.0.0.1:5173/oauth/callback',
    VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT: `${options.apiUrl}/oauth2/login`,
    VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT: `${options.apiUrl}/oauth2/authorize`,
    VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT: `${options.apiUrl}/oauth2/token`,
    VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT: `${options.apiUrl}/v1/me`,
    VITE_COURSEBOARD_BROWSER_SCOPES: 'openid profile email',
    VITE_AUTH_PROXY_TARGET: 'https://courseboard.txcloud.app',
    VITE_DEV_API_PROXY_TARGET: 'https://courseboard.txcloud.app',
    VITE_COURSEBOARD_MODE: 'production',
  }

  if (options.dryRun) {
    console.log(`Validated '${client.name}' via Tachyon profile '${profile}'.`)
    console.log(`Would write ${Object.keys(values).length} public values to ${options.envFile}.`)
    return
  }
  const outputPath = writeEnvFile(options.envFile, values)
  console.log(`Configured ${outputPath}`)
  console.log(`OAuth client: ${client.name} (${client.clientId})`)
  console.log('No client secret was read or written.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
