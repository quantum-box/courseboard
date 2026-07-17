import { describe, expect, it } from 'vitest'
import {
  parseArgs,
  parseEnvFile,
  updateEnvContent,
  usableSecret,
} from './configure-local-auth.mjs'

describe('configure-local-auth', () => {
  it('configures a local confidential web session by default', () => {
    expect(parseArgs([], {})).toMatchObject({
      callbackUrl: 'http://127.0.0.1:5173/api/auth/callback/tachyon',
      clientName: 'courseboard-local-web',
      dryRun: false,
      rotateSecret: false,
      uiEnvFile: '.env.local',
      webHostEnvFile: 'web-host/.env.local',
    })
  })

  it('accepts an explicit secret rotation request', () => {
    expect(parseArgs(['--profile', 'field', '--rotate-secret'], {})).toMatchObject({
      profile: 'field',
      rotateSecret: true,
    })
  })

  it('removes obsolete browser PKCE values while preserving unrelated env', () => {
    const updated = updateEnvContent(
      'VITE_COURSEBOARD_AUTH_MODE=browser-pkce\nVITE_COURSEBOARD_BROWSER_CLIENT_ID=old\nOTHER=value\n',
      {
        VITE_COURSEBOARD_AUTH_MODE: 'web-session',
        VITE_AUTH_PROXY_TARGET: 'http://localhost:3001',
      },
      ['VITE_COURSEBOARD_BROWSER_CLIENT_ID'],
    )

    expect(parseEnvFile(updated)).toEqual({
      VITE_COURSEBOARD_AUTH_MODE: 'web-session',
      VITE_AUTH_PROXY_TARGET: 'http://localhost:3001',
      OTHER: 'value',
    })
  })

  it('rejects placeholder secrets and accepts generated-strength secrets', () => {
    expect(usableSecret('local-secret-placeholder-value')).toBe(false)
    expect(usableSecret('0123456789abcdefghijklmnopqrstuvwxyzABCDEFG')).toBe(true)
  })
})
