import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  browserPkceProdApiUiValues,
  developmentUiClearValues,
  parseEnvFile,
  parseFieldArgs,
  parsePkceArgs,
  parseProdApiArgs,
  PROD_API_PUBLIC_CLIENT_NAME,
  PROD_COURSEBOARD_API_URL,
  PRODUCTION_COGNITO_ISSUER,
  PRODUCTION_COGNITO_REGION,
  updateEnvContent,
} from './configure.mjs'

describe('packaged app profile endpoints', () => {
  it('keeps CI and release builds on the courseboard-api profile proxy', () => {
    for (const workflow of ['ci.yml', 'desktop-release.yml', 'mobile-release.yml']) {
      const source = readFileSync(
        new URL(`../../.github/workflows/${workflow}`, import.meta.url),
        'utf8',
      )
      const endpoints = [...source.matchAll(
        /VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT:\s*(\S+)/g,
      )].map(match => match[1])

      expect(endpoints.length).toBeGreaterThan(0)
      expect(new Set(endpoints)).toEqual(new Set([
        `${PROD_COURSEBOARD_API_URL}/v1/me`,
      ]))
    }
  })
})

describe('configure pkce', () => {
  it('configures browser-pkce defaults', () => {
    expect(parsePkceArgs([], {})).toMatchObject({
      callbackUrl: 'http://127.0.0.1:5173/oauth/callback',
      clientName: 'courseboard-local-pkce',
      dryRun: false,
      uiEnvFile: '.env.local',
      apiEnvFile: '../.env.browser-pkce',
      tenantId: 'tn_01kxd5gdvm9thcbj8c2e8c6yhq',
    })
  })

  it('accepts profile and tenant overrides', () => {
    expect(parsePkceArgs(['--profile', 'field', '--tenant-id', 'tn_01abc'], {})).toMatchObject({
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
        OIDC_ISSUER_URL: PRODUCTION_COGNITO_ISSUER,
        EXPECTED_AUDIENCE: 'local-pkce-client',
        EXPECTED_CLIENT_ID: 'local-pkce-client',
        TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
      },
      ['COURSEBOARD_DEV_BEARER_TOKEN'],
    )

    expect(parseEnvFile(updated)).toEqual({
      OIDC_ISSUER_URL: PRODUCTION_COGNITO_ISSUER,
      EXPECTED_AUDIENCE: 'local-pkce-client',
      EXPECTED_CLIENT_ID: 'local-pkce-client',
      TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
    })
  })

  it('removes stale CLI Field bearer override from older pkce:env runs', () => {
    const updated = updateEnvContent(
      [
        'TACHYON_FIELD_API_BEARER_TOKEN=stale-cli-cognito',
        `OIDC_ISSUER_URL=${PRODUCTION_COGNITO_ISSUER}`,
        'EXPECTED_AUDIENCE=old-client',
        '',
      ].join('\n'),
      {
        OIDC_ISSUER_URL: PRODUCTION_COGNITO_ISSUER,
        EXPECTED_AUDIENCE: 'local-pkce-client',
        EXPECTED_CLIENT_ID: 'local-pkce-client',
        TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
      },
      ['COURSEBOARD_DEV_BEARER_TOKEN', 'TACHYON_FIELD_API_BEARER_TOKEN'],
    )

    expect(parseEnvFile(updated)).toEqual({
      OIDC_ISSUER_URL: PRODUCTION_COGNITO_ISSUER,
      EXPECTED_AUDIENCE: 'local-pkce-client',
      EXPECTED_CLIENT_ID: 'local-pkce-client',
      TACHYON_FIELD_API_URL: 'https://tachyon-field-api.txcloud.app',
    })
  })
})

describe('configure field', () => {
  it('defaults to production Field URL and ignored env files', () => {
    expect(parseFieldArgs([], {})).toMatchObject({
      apiEnvFile: '../.env.prod-field',
      dryRun: false,
      fieldApiUrl: 'https://tachyon-field-api.txcloud.app',
      uiEnvFile: '.env.local',
    })
  })

  it('accepts profile and tenant overrides', () => {
    expect(
      parseFieldArgs(['--profile', 'field', '--tenant-id', 'tn_01example'], {}),
    ).toMatchObject({
      profile: 'field',
      tenantId: 'tn_01example',
    })
  })

  it('updates managed keys without printing secrets in content helpers', () => {
    const updated = updateEnvContent(
      'VITE_COURSEBOARD_AUTH_MODE=web-session\nVITE_AUTH_PROXY_TARGET=http://localhost:3001\nOTHER=keep\n',
      {
        VITE_COURSEBOARD_AUTH_MODE: 'development',
        VITE_COURSEBOARD_MOCK_DATA: 'false',
        VITE_DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080',
      },
      ['VITE_AUTH_PROXY_TARGET'],
    )

    expect(parseEnvFile(updated)).toEqual({
      VITE_COURSEBOARD_AUTH_MODE: 'development',
      OTHER: 'keep',
      VITE_COURSEBOARD_MOCK_DATA: 'false',
      VITE_DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080',
    })
  })

  it('clears browser-pkce keys with empty strings so leftovers cannot win', () => {
    const updated = updateEnvContent(
      [
        'VITE_COURSEBOARD_AUTH_MODE=browser-pkce',
        'VITE_COURSEBOARD_BROWSER_CLIENT_ID=stale-public',
        'VITE_COURSEBOARD_BROWSER_REDIRECT_URI=http://127.0.0.1:5173/oauth/callback',
        'VITE_AUTH_PROXY_TARGET=http://localhost:3001',
        'OTHER=keep',
        '',
      ].join('\n'),
      {
        VITE_COURSEBOARD_AUTH_MODE: 'development',
        VITE_COURSEBOARD_MOCK_DATA: 'false',
        VITE_DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080',
        ...developmentUiClearValues(),
      },
    )

    const parsed = parseEnvFile(updated)
    expect(parsed.VITE_COURSEBOARD_AUTH_MODE).toBe('development')
    expect(parsed.VITE_COURSEBOARD_BROWSER_CLIENT_ID).toBe('')
    expect(parsed.VITE_COURSEBOARD_BROWSER_REDIRECT_URI).toBe('')
    expect(parsed.VITE_AUTH_PROXY_TARGET).toBe('')
    expect(parsed.OTHER).toBe('keep')
    expect(parsed.VITE_DEV_API_PROXY_TARGET).toBe('http://127.0.0.1:8080')
  })
})

describe('configure prod-api', () => {
  it('defaults to production courseboard-api overlay file with cli login', () => {
    expect(parseProdApiArgs([], {})).toMatchObject({
      apiUrl: 'https://api.n1.tachy.one',
      courseApiUrl: PROD_COURSEBOARD_API_URL,
      dryRun: false,
      fieldApiUrl: 'https://tachyon-field-api.txcloud.app',
      login: 'cli',
      clientName: PROD_API_PUBLIC_CLIENT_NAME,
      uiEnvFile: '.env.prod-api.local',
    })
  })

  it('accepts password login and profile / tenant / course API overrides', () => {
    expect(
      parseProdApiArgs(
        [
          '--login',
          'password',
          '--profile',
          'field',
          '--tenant-id',
          'tn_01example',
          '--course-api-url',
          'https://courseboard-api.example.test',
        ],
        {},
      ),
    ).toMatchObject({
      courseApiUrl: 'https://courseboard-api.example.test',
      login: 'password',
      profile: 'field',
      tenantId: 'tn_01example',
    })
  })

  it('rejects unknown login modes', () => {
    expect(() => parseProdApiArgs(['--login', 'hosted-ui'], {})).toThrow(/--login must be/)
  })

  it('writes direct API configuration and clears browser-pkce overlay values', () => {
    const updated = updateEnvContent(
      [
        'VITE_COURSEBOARD_AUTH_MODE=browser-pkce',
        'VITE_COURSEBOARD_BROWSER_CLIENT_ID=stale',
        'VITE_COURSEBOARD_BROWSER_REDIRECT_URI=http://127.0.0.1:5173/oauth/callback',
        'VITE_AUTH_PROXY_TARGET=http://localhost:3001',
        'VITE_COURSEBOARD_API_BASE_URL=https://stale.example',
        'OTHER=keep',
        '',
      ].join('\n'),
      {
        VITE_COURSEBOARD_AUTH_MODE: 'development',
        VITE_COURSEBOARD_MOCK_DATA: 'false',
        VITE_DEV_API_PROXY_TARGET: '',
        VITE_COURSEBOARD_API_BASE_URL: PROD_COURSEBOARD_API_URL,
        ...developmentUiClearValues(),
      },
    )

    const parsed = parseEnvFile(updated)
    expect(parsed).toMatchObject({
      VITE_COURSEBOARD_AUTH_MODE: 'development',
      OTHER: 'keep',
      VITE_COURSEBOARD_MOCK_DATA: 'false',
      VITE_DEV_API_PROXY_TARGET: '',
      VITE_COURSEBOARD_BROWSER_CLIENT_ID: '',
      VITE_COURSEBOARD_BROWSER_REDIRECT_URI: '',
      VITE_COURSEBOARD_API_BASE_URL: PROD_COURSEBOARD_API_URL,
    })
    // Empty string must remain present — omitting the key lets .env.local win.
    expect(updated).toContain('VITE_COURSEBOARD_BROWSER_CLIENT_ID=\n')
  })

  it('writes Cognito direct overlay without Local operator bearer', () => {
    const values = browserPkceProdApiUiValues({
      clientId: 'local-prod-public',
      callbackUrl: 'http://127.0.0.1:5173/oauth/callback',
      courseApiUrl: PROD_COURSEBOARD_API_URL,
      tenantId: 'tn_01example',
    })
    expect(values).toMatchObject({
      VITE_COURSEBOARD_AUTH_MODE: 'cognito-direct',
      VITE_COURSEBOARD_BROWSER_CLIENT_ID: 'local-prod-public',
      VITE_COURSEBOARD_COGNITO_REGION: PRODUCTION_COGNITO_REGION,
      VITE_COURSEBOARD_API_BEARER: '',
      VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT: `${PROD_COURSEBOARD_API_URL}/v1/me`,
      VITE_DEV_API_PROXY_TARGET: '',
      VITE_COURSEBOARD_API_BASE_URL: PROD_COURSEBOARD_API_URL,
    })

    const updated = updateEnvContent(
      [
        'VITE_COURSEBOARD_AUTH_MODE=development',
        'VITE_COURSEBOARD_API_BEARER=stale-cli-jwt',
        'VITE_COURSEBOARD_BROWSER_CLIENT_ID=',
        'OTHER=keep',
        '',
      ].join('\n'),
      values,
    )
    const parsed = parseEnvFile(updated)
    expect(parsed.VITE_COURSEBOARD_AUTH_MODE).toBe('cognito-direct')
    expect(parsed.VITE_COURSEBOARD_API_BEARER).toBe('')
    expect(parsed.VITE_COURSEBOARD_BROWSER_CLIENT_ID).toBe('local-prod-public')
    expect(parsed.OTHER).toBe('keep')
  })
})
