import { describe, expect, it } from 'vitest'
import {
  parseArgs,
  parseEnvFile,
  updateEnvContent,
} from './configure-local-browser-pkce.mjs'

describe('configure-local-browser-pkce', () => {
  it('configures browser-pkce defaults', () => {
    expect(parseArgs([], {})).toMatchObject({
      callbackUrl: 'http://127.0.0.1:5173/oauth/callback',
      clientName: 'courseboard-local-pkce',
      dryRun: false,
      uiEnvFile: '.env.local',
      apiEnvFile: '../.env.browser-pkce',
      tenantId: 'tn_01kxd5gdvm9thcbj8c2e8c6yhq',
    })
  })

  it('accepts profile and tenant overrides', () => {
    expect(parseArgs(['--profile', 'field', '--tenant-id', 'tn_01abc'], {})).toMatchObject({
      profile: 'field',
      tenantId: 'tn_01abc',
    })
  })

  it('removes Auth.js bearer/proxy keys while writing browser-pkce values', () => {
    const updated = updateEnvContent(
      [
        'VITE_COURSEBOARD_AUTH_MODE=web-session',
        'VITE_AUTH_PROXY_TARGET=http://localhost:3001',
        'VITE_COURSEBOARD_API_BEARER=stale-jwt',
        'OTHER=keep',
        '',
      ].join('\n'),
      {
        VITE_COURSEBOARD_AUTH_MODE: 'browser-pkce',
        VITE_COURSEBOARD_BROWSER_CLIENT_ID: 'public-client',
        VITE_COURSEBOARD_MOCK_DATA: 'false',
      },
      ['VITE_AUTH_PROXY_TARGET', 'VITE_COURSEBOARD_API_BEARER'],
    )

    expect(parseEnvFile(updated)).toEqual({
      VITE_COURSEBOARD_AUTH_MODE: 'browser-pkce',
      VITE_COURSEBOARD_BROWSER_CLIENT_ID: 'public-client',
      VITE_COURSEBOARD_MOCK_DATA: 'false',
      OTHER: 'keep',
    })
  })

  it('removes static course-api bearer when switching to OIDC', () => {
    const updated = updateEnvContent(
      'COURSEBOARD_DEV_BEARER_TOKEN=stale\nTACHYON_FIELD_API_URL=https://example.test\n',
      {
        OIDC_ISSUER_URL: 'https://api.n1.tachy.one',
        EXPECTED_AUDIENCE: 'local-pkce-client',
        TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
      },
      ['COURSEBOARD_DEV_BEARER_TOKEN'],
    )

    expect(parseEnvFile(updated)).toEqual({
      OIDC_ISSUER_URL: 'https://api.n1.tachy.one',
      EXPECTED_AUDIENCE: 'local-pkce-client',
      TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
    })
  })

  it('removes stale CLI Field bearer override from older pkce:env runs', () => {
    const updated = updateEnvContent(
      [
        'TACHYON_FIELD_API_BEARER_TOKEN=stale-cli-cognito',
        'OIDC_ISSUER_URL=https://api.n1.tachy.one',
        'EXPECTED_AUDIENCE=old-client',
        '',
      ].join('\n'),
      {
        OIDC_ISSUER_URL: 'https://api.n1.tachy.one',
        EXPECTED_AUDIENCE: 'local-pkce-client',
        TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
      },
      ['COURSEBOARD_DEV_BEARER_TOKEN', 'TACHYON_FIELD_API_BEARER_TOKEN'],
    )

    expect(parseEnvFile(updated)).toEqual({
      OIDC_ISSUER_URL: 'https://api.n1.tachy.one',
      EXPECTED_AUDIENCE: 'local-pkce-client',
      TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
    })
  })
})
