import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('DevelopmentAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_API_BEARER', 'dev-bearer-token')
    vi.stubEnv('VITE_COURSEBOARD_TENANT_ID', 'courseboard_id')
    vi.stubEnv('VITE_COURSEBOARD_TENANT_NAME', 'CourseBoard Demo')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    // Exclusive development opt-in: no browser-pkce public client.
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_CLIENT_ID', '')
    vi.stubGlobal('window', {
      location: {
        search: '',
        href: 'http://127.0.0.1:5173/',
        reload: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('soft-signs out on expired without reloading the page', async () => {
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()
    const reload = window.location.reload as ReturnType<typeof vi.fn>

    expect((await adapter.bootstrap()).kind).toBe('authenticated')
    expect(await adapter.getAccessToken()).toBe('dev-bearer-token')

    await adapter.signOut('expired')

    expect(reload).not.toHaveBeenCalled()
    expect(await adapter.getAccessToken()).toBeUndefined()
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous', reason: 'expired' })
  })

  it('restores the configured bearer on sign-in after soft sign-out', async () => {
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()

    await adapter.signOut('expired')
    await adapter.signIn()

    expect(await adapter.getAccessToken()).toBe('dev-bearer-token')
    expect((await adapter.bootstrap()).kind).toBe('authenticated')
  })

  it('exposes configured tenant name and slug for local demo chrome only', async () => {
    vi.stubEnv('VITE_COURSEBOARD_TENANT_SLUG', 'courseboard')
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()
    const result = await adapter.bootstrap()

    expect(result).toMatchObject({
      kind: 'authenticated',
      tenants: [{ id: 'courseboard_id', name: 'CourseBoard Demo', slug: 'courseboard' }],
    })
  })

  it('does not overlay local demo name/slug when connected to prod Field', async () => {
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    vi.stubEnv('VITE_COURSEBOARD_TENANT_SLUG', 'courseboard')
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()
    const result = await adapter.bootstrap()

    expect(result).toMatchObject({
      kind: 'authenticated',
      tenants: [{ id: 'courseboard_id', name: 'courseboard_id' }],
    })
    expect(result.kind === 'authenticated' && result.tenants[0]?.slug).toBeUndefined()
  })

  it('fails visibly instead of falling back to Local operator when browser-pkce is also configured', async () => {
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_CLIENT_ID', 'local-public-client')
    const { createAuthAdapter } = await import('./adapters')
    const { AuthConfigurationError } = await import('./types')

    expect(() => createAuthAdapter()).toThrow(AuthConfigurationError)
    try {
      createAuthAdapter()
      expect.unreachable('expected AuthConfigurationError')
    } catch (error) {
      expect(error).toBeInstanceOf(AuthConfigurationError)
      expect(error).toMatchObject({
        title: '認証モードが衝突しています',
        message: expect.stringContaining('browser-pkce'),
      })
    }
  })

  it('treats blank or whitespace browser client id as unset under development mode', async () => {
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_CLIENT_ID', '   ')
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()
    const result = await adapter.bootstrap()

    expect(result).toMatchObject({
      kind: 'authenticated',
      user: { id: 'local-operator', name: 'Local operator', role: 'DEVELOPMENT' },
    })
  })

  it('bootstraps as Local operator only for explicit development opt-in', async () => {
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()
    const result = await adapter.bootstrap()

    expect(result).toMatchObject({
      kind: 'authenticated',
      user: { id: 'local-operator', name: 'Local operator', role: 'DEVELOPMENT' },
    })
  })
})

function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(() => {
      store.clear()
    }),
    get store() {
      return store
    },
  }
}

describe('BrowserPkceAdapter', () => {
  let localStorageMock: ReturnType<typeof memoryStorage>
  let sessionStorageMock: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'browser-pkce')
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_CLIENT_ID', 'local-public-client')
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_REDIRECT_URI', 'http://127.0.0.1:5173/oauth/callback')
    vi.stubEnv('VITE_COURSEBOARD_TENANT_ID', 'tn_01example')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    localStorageMock = memoryStorage()
    sessionStorageMock = memoryStorage()
    vi.stubGlobal('window', {
      location: {
        search: '',
        href: 'http://127.0.0.1:5173/',
        reload: vi.fn(),
      },
    })
    vi.stubGlobal('localStorage', localStorageMock)
    vi.stubGlobal('sessionStorage', sessionStorageMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes password sign-in and starts anonymous without a refresh token', async () => {
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()

    expect(typeof adapter.signInWithPassword).toBe('function')
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous' })
  })

  it('uses the React password JSON PKCE flow when a public client is configured and AUTH_MODE is unset', async () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', '')
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()

    expect(typeof adapter.signInWithPassword).toBe('function')
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous' })
  })

  it('rejects username/password prompts when signIn is used without credentials', async () => {
    const { createAuthAdapter } = await import('./adapters')
    const { NativeAuthorizationError } = await import('./pkce')
    const adapter = createAuthAdapter()
    await expect(adapter.signIn()).rejects.toBeInstanceOf(NativeAuthorizationError)
  })

  it('restores a fresh access token from localStorage across adapter recreation', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    const accessToken = 'persisted-access-token'
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken,
      refreshToken: 'persisted-refresh-token',
      accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    }))

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/me')) {
        return new Response(JSON.stringify({
          user: { id: 'user-1', username: 'operator', email: 'op@example.com' },
          tenants: [{ id: 'tn_01example', name: 'Example Club' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = createAuthAdapter()
    const firstBootstrap = await first.bootstrap()
    expect(firstBootstrap).toMatchObject({
      kind: 'authenticated',
      user: { id: 'user-1' },
      tenants: [{ id: 'tn_01example' }],
    })
    expect(await first.getAccessToken()).toBe(accessToken)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Simulate Vite HMR / hard refresh: new adapter, same durable storage.
    const second = createAuthAdapter()
    const secondBootstrap = await second.bootstrap()
    expect(secondBootstrap).toMatchObject({ kind: 'authenticated', user: { id: 'user-1' } })
    expect(await second.getAccessToken()).toBe(accessToken)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/v1/me'))).toBe(true)
  })

  it('refreshes an expired access token from the persisted refresh token on bootstrap', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken: 'stale-access-token',
      refreshToken: 'persisted-refresh-token',
      accessTokenExpiresAt: Date.now() - 1_000,
    }))

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { grant_type?: string; refresh_token?: string }
        expect(body).toMatchObject({
          grant_type: 'refresh_token',
          refresh_token: 'persisted-refresh-token',
        })
        return new Response(JSON.stringify({
          access_token: 'rotated-access-token',
          refresh_token: 'rotated-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/me')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer rotated-access-token' })
        return new Response(JSON.stringify({
          user: { id: 'user-1', username: 'operator' },
          tenants: [{ id: 'tn_01example' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createAuthAdapter()
    expect(await adapter.bootstrap()).toMatchObject({ kind: 'authenticated', user: { id: 'user-1' } })
    expect(await adapter.getAccessToken()).toBe('rotated-access-token')

    const stored = JSON.parse(localStorageMock.getItem(BROWSER_PKCE_SESSION_KEY) ?? '{}') as {
      accessToken?: string
      refreshToken?: string
    }
    expect(stored).toMatchObject({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
    })
  })

  it('clears durable storage on explicit sign-out', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken: 'persisted-access-token',
      refreshToken: 'persisted-refresh-token',
      accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    }))

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      user: { id: 'user-1', username: 'operator' },
      tenants: [{ id: 'tn_01example' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const adapter = createAuthAdapter()
    expect((await adapter.bootstrap()).kind).toBe('authenticated')
    await adapter.signOut('logout')

    expect(localStorageMock.getItem(BROWSER_PKCE_SESSION_KEY)).toBeNull()
    expect(await adapter.getAccessToken()).toBeUndefined()
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous' })
  })

  it('clears durable storage when refresh fails unrecoverably', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken: 'stale-access-token',
      refreshToken: 'dead-refresh-token',
      accessTokenExpiresAt: Date.now() - 1_000,
    }))

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const adapter = createAuthAdapter()
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous' })
    expect(localStorageMock.getItem(BROWSER_PKCE_SESSION_KEY)).toBeNull()
    expect(await adapter.getAccessToken()).toBeUndefined()
  })

  it('keeps durable storage when token refresh fails transiently (network)', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken: 'stale-access-token',
      refreshToken: 'persisted-refresh-token',
      accessTokenExpiresAt: Date.now() - 1_000,
    }))

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        throw new TypeError('Failed to fetch')
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createAuthAdapter()
    // Force-refresh must still return the stored bearer so API 401 recovery does
    // not soft-sign-out on a transient token-endpoint outage.
    expect(await adapter.getAccessToken(true)).toBe('stale-access-token')
    expect(JSON.parse(localStorageMock.getItem(BROWSER_PKCE_SESSION_KEY) ?? '{}')).toMatchObject({
      accessToken: 'stale-access-token',
      refreshToken: 'persisted-refresh-token',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not report session expiry when /v1/me keeps returning 401 after refresh', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    }))

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        return new Response(JSON.stringify({
          access_token: 'rotated-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/me')) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createAuthAdapter()
    await expect(adapter.bootstrap()).rejects.toThrow(/profile/)
    expect(localStorageMock.getItem(BROWSER_PKCE_SESSION_KEY)).toBeTruthy()
  })

  it('migrates a legacy sessionStorage refresh token into localStorage after refresh', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    sessionStorageMock.setItem('courseboard.auth.browser.refresh', 'legacy-refresh-token')

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        return new Response(JSON.stringify({
          access_token: 'migrated-access-token',
          refresh_token: 'migrated-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/me')) {
        return new Response(JSON.stringify({
          user: { id: 'user-1', username: 'operator' },
          tenants: [{ id: 'tn_01example' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createAuthAdapter()
    expect((await adapter.bootstrap()).kind).toBe('authenticated')
    expect(sessionStorageMock.getItem('courseboard.auth.browser.refresh')).toBeNull()
    expect(JSON.parse(localStorageMock.getItem(BROWSER_PKCE_SESSION_KEY) ?? '{}')).toMatchObject({
      accessToken: 'migrated-access-token',
      refreshToken: 'migrated-refresh-token',
    })
  })
})

describe('Production BrowserPkceAdapter', () => {
  let localStorageMock: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'browser-pkce')
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_CLIENT_ID', 'local-prod-public')
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_REDIRECT_URI', 'http://127.0.0.1:5173/oauth/callback')
    vi.stubEnv(
      'VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT',
      'https://api.n1.tachy.one/oauth2/login',
    )
    vi.stubEnv(
      'VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT',
      'https://api.n1.tachy.one/oauth2/authorize',
    )
    vi.stubEnv(
      'VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT',
      'https://api.n1.tachy.one/oauth2/token',
    )
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT', 'https://api.n1.tachy.one/v1/me')
    vi.stubEnv('VITE_COURSEBOARD_TENANT_ID', 'tn_01example')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    vi.stubEnv('VITE_COURSEBOARD_API_BEARER', '')
    localStorageMock = memoryStorage()
    vi.stubGlobal('window', {
      location: {
        search: '',
        href: 'http://127.0.0.1:5173/',
        origin: 'http://127.0.0.1:5173',
        reload: vi.fn(),
      },
      history: { replaceState: vi.fn(), state: null },
    })
    vi.stubGlobal('localStorage', localStorageMock)
    vi.stubGlobal('sessionStorage', memoryStorage())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('selects browser-pkce with the React password form and no redirect', async () => {
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()

    expect(typeof adapter.signInWithPassword).toBe('function')
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous' })
  })

  it('rejects the removed Cognito Hosted UI mode', async () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'cognito-pkce')
    const { createAuthAdapter } = await import('./adapters')

    expect(() => createAuthAdapter()).toThrow(
      'VITE_COURSEBOARD_AUTH_MODE=browser-pkceを使用してください。',
    )
  })

  it('derives the redirect URI from the https origin when env is unset', async () => {
    vi.stubEnv('VITE_COURSEBOARD_BROWSER_REDIRECT_URI', undefined)
    vi.stubGlobal('window', {
      location: {
        search: '',
        href: 'https://courseboard.txcloud.app/',
        origin: 'https://courseboard.txcloud.app',
        protocol: 'https:',
        reload: vi.fn(),
      },
      history: { replaceState: vi.fn(), state: null },
    })

    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous' })
  })

  it('accepts an https redirect URI and rejects non-callback paths', async () => {
    vi.stubEnv(
      'VITE_COURSEBOARD_BROWSER_REDIRECT_URI',
      'https://courseboard.txcloud.app/oauth/callback',
    )
    const { createAuthAdapter } = await import('./adapters')
    const adapter = createAuthAdapter()
    expect(await adapter.bootstrap()).toEqual({ kind: 'anonymous' })

    vi.resetModules()
    vi.stubEnv(
      'VITE_COURSEBOARD_BROWSER_REDIRECT_URI',
      'https://courseboard.txcloud.app/other-path',
    )
    const rejected = await import('./adapters')
    expect(() => rejected.createAuthAdapter()).toThrow(
      '/oauth/callback を使用してください',
    )
  })

  it('restores a JSON PKCE session and loads the real user profile', async () => {
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken: 'tachyon-access-token',
      refreshToken: 'tachyon-refresh-token',
      accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    }))

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/me')) {
        return new Response(JSON.stringify({
          user: { id: 'user-42', username: 'real.operator', name: 'Real Operator' },
          tenants: [{ id: 'tn_01example', name: 'Example Club' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const adapter = createAuthAdapter()
    const result = await adapter.bootstrap()
    expect(result).toMatchObject({
      kind: 'authenticated',
      user: { id: 'user-42', name: 'Real Operator' },
      tenants: [{ id: 'tn_01example' }],
    })
    expect(result.kind === 'authenticated' && result.user.name).not.toBe('Local operator')
    expect(await adapter.getAccessToken()).toBe('tachyon-access-token')
  })

  it('keeps a fresh JSON PKCE access token when force-refresh has no refresh token', async () => {
    // False-positive path: navigation 401 → getAccessToken(true) must not discard
    // a usable access token just because Cognito omitted refresh_token.
    const { BROWSER_PKCE_SESSION_KEY, createAuthAdapter } = await import('./adapters')
    localStorageMock.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify({
      accessToken: 'tachyon-access-only',
      accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    }))

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('token endpoint must not be called without a refresh token')
    }))

    const adapter = createAuthAdapter()
    expect(await adapter.getAccessToken(true)).toBe('tachyon-access-only')
    expect(JSON.parse(localStorageMock.getItem(BROWSER_PKCE_SESSION_KEY) ?? '{}')).toMatchObject({
      accessToken: 'tachyon-access-only',
    })
  })
})
