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
      apiEnvFile: '../.env.web-session',
    })
  })

  it('accepts an explicit secret rotation request', () => {
    expect(parseArgs(['--profile', 'field', '--rotate-secret'], {})).toMatchObject({
      profile: 'field',
      rotateSecret: true,
    })
  })

  it('removes obsolete browser PKCE and development bearer values while preserving unrelated env', () => {
    const updated = updateEnvContent(
      [
        'VITE_COURSEBOARD_AUTH_MODE=browser-pkce',
        'VITE_COURSEBOARD_BROWSER_CLIENT_ID=old',
        'VITE_COURSEBOARD_API_BEARER=stale-jwt',
        'VITE_COURSEBOARD_TENANT_ID=courseboard_id',
        'OTHER=value',
        '',
      ].join('\n'),
      {
        VITE_COURSEBOARD_AUTH_MODE: 'web-session',
        VITE_AUTH_PROXY_TARGET: 'http://localhost:3001',
        VITE_COURSEBOARD_MOCK_DATA: 'false',
      },
      [
        'VITE_COURSEBOARD_BROWSER_CLIENT_ID',
        'VITE_COURSEBOARD_API_BEARER',
        'VITE_COURSEBOARD_TENANT_ID',
        'VITE_COURSEBOARD_OPERATOR_ID',
      ],
    )

    expect(parseEnvFile(updated)).toEqual({
      VITE_COURSEBOARD_AUTH_MODE: 'web-session',
      VITE_AUTH_PROXY_TARGET: 'http://localhost:3001',
      VITE_COURSEBOARD_MOCK_DATA: 'false',
      OTHER: 'value',
    })
  })

  it('removes static course-api bearer when switching to OIDC verification', () => {
    const updated = updateEnvContent(
      'COURSEBOARD_DEV_BEARER_TOKEN=stale\nTACHYON_FIELD_API_URL=https://example.test\n',
      {
        OIDC_ISSUER_URL: 'https://cognito-idp.example/pool',
        EXPECTED_AUDIENCE: 'local-web-client',
        TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
      },
      ['COURSEBOARD_DEV_BEARER_TOKEN'],
    )

    expect(parseEnvFile(updated)).toEqual({
      OIDC_ISSUER_URL: 'https://cognito-idp.example/pool',
      EXPECTED_AUDIENCE: 'local-web-client',
      TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
    })
  })

  it('rejects placeholder secrets and accepts generated-strength secrets', () => {
    expect(usableSecret('local-secret-placeholder-value')).toBe(false)
    expect(usableSecret('0123456789abcdefghijklmnopqrstuvwxyzABCDEFG')).toBe(true)
  })
})
