import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureApiAuth,
  courseboardApiJson,
  protectedRequestCredentials,
  nowIsoMinute,
  shouldSoftSignOutOn401,
  today,
} from './api'
import { nowLinePercent } from './features/golf/timeline/timelineLayout'

describe('protectedRequestCredentials', () => {
  it('includes the HttpOnly session only for same-origin Web requests', () => {
    expect(protectedRequestCredentials('/field-api/v1/invoices', 'https://courseboard.example', false)).toBe('include')
  })

  it('omits credentials for Native and cross-origin requests', () => {
    expect(protectedRequestCredentials('https://courseboard.example/field-api/v1/invoices', 'tauri://localhost', true)).toBe('omit')
    expect(protectedRequestCredentials('https://api.example/field-api/v1/invoices', 'https://courseboard.example', false)).toBe('omit')
  })
})

describe('shouldSoftSignOutOn401', () => {
  it('signs out only when refresh cannot recover the session', () => {
    expect(shouldSoftSignOutOn401({
      hasAuthContext: true,
      alreadyRetried: false,
      refreshProducedToken: false,
    })).toBe(true)
  })

  it('does not treat a post-refresh 401 as session expiry (navigation false positive)', () => {
    expect(shouldSoftSignOutOn401({
      hasAuthContext: true,
      alreadyRetried: false,
      refreshProducedToken: true,
    })).toBe(false)
    expect(shouldSoftSignOutOn401({
      hasAuthContext: true,
      alreadyRetried: true,
      refreshProducedToken: false,
    })).toBe(false)
  })

  it('does not soft-sign-out without an auth context', () => {
    expect(shouldSoftSignOutOn401({
      hasAuthContext: false,
      alreadyRetried: false,
      refreshProducedToken: false,
    })).toBe(false)
  })
})

describe('protected API 401 handling', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COURSEBOARD_API_BASE_URL', '')
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'browser-pkce')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:5173',
        href: 'http://127.0.0.1:5173/',
        search: '',
      },
    })
  })

  afterEach(() => {
    configureApiAuth(null)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('does not send a protected request before the auth context is bound', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(courseboardApiJson('/cancellation-fee-collections')).rejects.toMatchObject({
      status: 401,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes before the first request when the current token is unavailable', async () => {
    const getAccessToken = vi.fn(async (force?: boolean) =>
      force ? 'initial-refreshed-token' : undefined)
    configureApiAuth({
      tenantId: 'tn_1',
      operatorId: 'tn_1',
      platformId: 'plat_1',
      getAccessToken,
      onUnauthorized: vi.fn(),
      onForbidden: vi.fn(),
    })
    const fetchMock = vi.fn(
      async (..._args: [RequestInfo | URL, RequestInit?]) =>
        Response.json({ items: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(courseboardApiJson('/cancellation-fee-collections')).resolves.toEqual({
      items: [],
    })
    expect(getAccessToken).toHaveBeenNthCalledWith(1, false)
    expect(getAccessToken).toHaveBeenNthCalledWith(2, true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer initial-refreshed-token')
  })

  it('does not call onUnauthorized when a refreshed token still receives 401', async () => {
    const onUnauthorized = vi.fn()
    configureApiAuth({
      tenantId: 'tn_1',
      operatorId: 'tn_1',
      platformId: 'plat_1',
      getAccessToken: async (force) => (force ? 'refreshed-token' : 'stale-token'),
      onUnauthorized,
      onForbidden: vi.fn(),
    })

    const fetchMock = vi.fn(async (..._args: [RequestInfo | URL, RequestInit?]) =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    // Use a non-course path so development Field mocks cannot short-circuit fetch.
    await expect(courseboardApiJson('/cancellation-fee-collections')).rejects.toMatchObject({
      status: 401,
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(firstHeaders.get('authorization')).toBe('Bearer stale-token')
    expect(firstHeaders.get('x-courseboard-authorization')).toBe('Bearer stale-token')
    expect(secondHeaders.get('authorization')).toBe('Bearer refreshed-token')
  })

  it('calls onUnauthorized when refresh cannot produce a token', async () => {
    const onUnauthorized = vi.fn()
    configureApiAuth({
      tenantId: 'tn_1',
      operatorId: 'tn_1',
      platformId: 'plat_1',
      getAccessToken: async (force) => (force ? undefined : 'stale-token'),
      onUnauthorized,
      onForbidden: vi.fn(),
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(courseboardApiJson('/cancellation-fee-collections')).rejects.toMatchObject({
      status: 401,
    })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('does not soft-sign-out when force-refresh only returns the existing access token', async () => {
    // Cognito access-only session: getAccessToken(true) keeps the fresh bearer.
    const onUnauthorized = vi.fn()
    configureApiAuth({
      tenantId: 'tn_1',
      operatorId: 'tn_1',
      platformId: 'plat_1',
      getAccessToken: async () => 'cognito-access-only',
      onUnauthorized,
      onForbidden: vi.fn(),
    })

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(courseboardApiJson('/cancellation-fee-collections')).rejects.toMatchObject({
      status: 401,
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('nowIsoMinute', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the course-local minute, not the machine-local one', () => {
    // A laptop parked in UTC must still show the hour the course is working.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T21:30:00Z'))
    expect(nowIsoMinute()).toBe('2026-08-05T06:30')
  })

  it('rolls the date over on the course clock, not UTC', () => {
    // 06:00 JST is the previous day in UTC — the case that misfiled clock-ins.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T22:00:00Z'))
    expect(nowIsoMinute()).toBe('2026-08-04T07:00')
    expect(today()).toBe('2026-08-04')
  })

  it('parses back into the timeline now line', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T01:00:00Z'))
    expect(nowLinePercent(nowIsoMinute(), today())).toBeGreaterThan(0)
  })

  it('is not pinned to the retired demo fixture date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T01:00:00Z'))
    expect(nowIsoMinute().startsWith('2026-07-18')).toBe(false)
  })
})
