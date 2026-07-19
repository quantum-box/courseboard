#!/usr/bin/env node
/**
 * Shared helpers for desktop/scripts/configure.mjs
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

export const DEFAULT_MANAGED_COMMENT =
  '# Managed by desktop/scripts/configure.mjs. Do not commit.'

export function tachyonConfigDirectory() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'tachyon')
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'tachyon')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tachyon')
}

export function activeProfile(configDirectory, requestedProfile) {
  if (requestedProfile?.trim()) return requestedProfile.trim()
  const activeProfileFile = join(configDirectory, 'active_profile')
  if (existsSync(activeProfileFile)) {
    const value = readFileSync(activeProfileFile, 'utf8').trim()
    if (value) return value
  }
  return 'default'
}

export function refreshCliProfile(profile) {
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

export function profileCredentials(configDirectory, profile) {
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

export function absolutePath(filePath) {
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

export function readEnvFile(filePath) {
  const path = absolutePath(filePath)
  return existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : {}
}

export function updateEnvContent(
  existing,
  values,
  removeKeys = [],
  managedComment = DEFAULT_MANAGED_COMMENT,
) {
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
    updated.push(managedComment)
    for (const key of missing) updated.push(`${key}=${values[key]}`)
  }
  return `${updated.join('\n')}\n`
}

export function writeEnvFile(filePath, values, removeKeys = [], managedComment) {
  const path = absolutePath(filePath)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const temporaryPath = join(dirname(path), `.${basename(path)}.tmp`)
  writeFileSync(
    temporaryPath,
    updateEnvContent(existing, values, removeKeys, managedComment),
    { encoding: 'utf8', mode: 0o600 },
  )
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, path)
  chmodSync(path, 0o600)
  return path
}

/**
 * @param {string[]} argv
 * @param {Record<string, unknown>} defaults
 * @param {Map<string, string>} valueOptions
 * @param {{ dryRun?: boolean, rotateSecret?: boolean }} [flags]
 */
export function parseFlagArgs(argv, defaults, valueOptions, flags = {}) {
  const options = {
    ...defaults,
    dryRun: false,
    ...(flags.rotateSecret !== undefined ? { rotateSecret: false } : {}),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (flags.rotateSecret && argument === '--rotate-secret') {
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

export function authHeaders(accessToken, tenantId, extra = {}) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'x-operator-id': tenantId,
    ...extra,
  }
}

export async function requestJson(url, init, action) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(
      `${action} failed (HTTP ${response.status}). Check profile and tenant.`,
    )
  }
  return response.json()
}

export function hasRequiredValues(actual, required) {
  return required.every(value => actual.includes(value))
}

export function jwtExpirySeconds(accessToken) {
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

export function jwtClaims(accessToken) {
  const parts = accessToken.split('.')
  if (parts.length < 2) return {}
  try {
    return JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    )
  } catch {
    return {}
  }
}
