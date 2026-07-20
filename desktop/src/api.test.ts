import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureApiAuth,
  courseboardApiJson,
  protectedRequestCredentials,
  shouldSoftSignOutOn401,
} from './api'

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
    expect(firstHeaders.get('authorization')).toBe('Bearer stale-token')
    expect(firstHeaders.get('x-courseboard-authorization')).toBe('Bearer stale-token')
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
