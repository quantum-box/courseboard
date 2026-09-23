import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureApiAuth } from '../api'
import {
  evaluateFeatureFlags,
  resolveFeatureFlagValues,
} from './feature-flags-api'

const CANARY = 'feature.courseboard.flag-evaluation-smoke'
const UNDECLARED = 'feature.courseboard.not-declared'

describe('CourseBoard feature flag evaluation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COURSEBOARD_API_BASE_URL', '')
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'browser-pkce')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:5173',
        href: 'http://127.0.0.1:5173/',
      },
    })
    configureApiAuth({
      tenantId: 'tn_1',
      operatorId: 'tn_1',
      platformId: 'plat_1',
      getAccessToken: async () => 'test-token',
      onUnauthorized: vi.fn(),
      onForbidden: vi.fn(),
    })
  })

  afterEach(() => {
    configureApiAuth(null)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('defaults undeclared and omitted flags to disabled', () => {
    expect(
      resolveFeatureFlagValues([CANARY, UNDECLARED], [
        { enabled: true, key: CANARY },
      ]),
    ).toEqual({
      [CANARY]: true,
      [UNDECLARED]: false,
    })
  })

  it('uses the CourseBoard API boundary for batch evaluation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ values: [{ enabled: true, key: CANARY }] }),
      { status: 200 },
    ))

    await expect(evaluateFeatureFlags([CANARY])).resolves.toEqual({ [CANARY]: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/course/feature-flags/evaluate')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ keys: [CANARY] }),
      method: 'POST',
    })
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer test-token')
    expect(headers.get('x-operator-id')).toBe('tn_1')
  })
})
