import { describe, expect, it } from 'vitest'
import {
  parseArgs,
  parseEnvFile,
  updateEnvContent,
} from './configure-local-prod-field.mjs'

describe('configure-local-prod-field', () => {
  it('defaults to production Field URL and ignored env files', () => {
    expect(parseArgs([], {})).toMatchObject({
      apiEnvFile: '../.env.prod-field',
      dryRun: false,
      fieldApiUrl: 'https://tachyon-field-api.txcloud.app',
      uiEnvFile: '.env.local',
    })
  })

  it('accepts profile and tenant overrides', () => {
    expect(
      parseArgs(['--profile', 'field', '--tenant-id', 'tn_01example'], {}),
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
})
