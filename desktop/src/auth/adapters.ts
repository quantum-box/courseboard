import { invoke } from '@tauri-apps/api/core'
import { platformKind } from '../lib/platform'
import {
  NATIVE_AUTH_PENDING_KEY,
  NativeAuthorizationError,
  createPkceTransaction,
  parseAuthorizationCallback,
  type PkceTransaction,
} from './pkce'
import {
  AuthConfigurationError,
  type AuthAdapter,
  type AuthBootstrapResult,
  type AuthReason,
  type AuthTenant,
  type AuthUser,
} from './types'

type SessionPayload = {
  error?: string
  user?: {
    id?: string
    username?: string
    name?: string | null
    email?: string | null
    role?: string
    tenants?: string[]
  }
}

type WebAuthContextPayload = SessionPayload & {
  tenants?: NativeTenantPayload[]
  partial?: boolean
}

type NativeAuthConfiguration = {
  authorizationEndpoint: string
  tokenEndpoint: string
  profileEndpoint: string
  clientId: string
  redirectUri: string
  scopes: string[]
}

type BrowserPkceConfiguration = Omit<NativeAuthConfiguration, 'authorizationEndpoint' | 'profileEndpoint'> & {
  loginEndpoint: string
  authorizationEndpoint: string
  profileEndpoint: string
}

type NativeTokenPayload = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

type BrowserLoginPayload = {
  status?: 'authenticated' | 'new_password_required'
  session_token?: string
  session?: string
}

type BrowserAuthorizationPayload = {
  authorization_code?: string
}

type NativeTenantPayload = string | {
  id?: string
  name?: string
  slug?: string
  alias?: string
  mode?: 'production' | 'sandbox'
  platformId?: string
  operatorId?: string
}

type NativeProfilePayload = SessionPayload & {
  tenants?: NativeTenantPayload[]
  partial?: boolean
}

type NativeAuthCapabilities = {
  externalBrowser: boolean
  callbackMode: string
}

const RUNTIME_CONTEXT = {
  production: {
    platformId: 'tn_01hjjn348rn3t49zz6hvmfq67p',
  },
  sandbox: {
    platformId: 'tn_01hjryxysgey07h5jz5wagqj0m',
  },
} as const

function runtimeMode(): AuthTenant['mode'] {
  const query = new URLSearchParams(window.location.search)
  return import.meta.env.VITE_COURSEBOARD_MODE === 'sandbox'
    || query.get('mode') === 'sandbox'
    || query.get('_mode') === 'sandbox'
    ? 'sandbox'
    : 'production'
}

/**
 * Local mock/demo chrome only.
 * Never overlay name/slug onto prod Field tenants (`MOCK_DATA=false`).
 */
function usesLocalDemoTenantChrome() {
  const flag = import.meta.env.VITE_COURSEBOARD_MOCK_DATA
  if (flag === 'false' || flag === '0') return false
  return import.meta.env.VITE_COURSEBOARD_AUTH_MODE === 'development'
    || flag === 'true'
}

function envTenantLabels(id: string): { name?: string; slug?: string } {
  if (!usesLocalDemoTenantChrome()) return {}
  const envId = import.meta.env.VITE_COURSEBOARD_TENANT_ID?.trim()
  // Only attach local chrome labels to the configured default tenant.
  if (envId && envId !== id) return {}
  const name = import.meta.env.VITE_COURSEBOARD_TENANT_NAME?.trim()
  const slug = import.meta.env.VITE_COURSEBOARD_TENANT_SLUG?.trim()
  return {
    ...(name ? { name } : {}),
    ...(slug ? { slug } : {}),
  }
}

function envTenant(id: string, name = id): AuthTenant {
  const mode = runtimeMode()
  const labels = envTenantLabels(id)
  const resolvedName = (name && name !== id ? name : undefined) || labels.name || name
  return {
    id,
    name: resolvedName,
    ...(labels.slug ? { slug: labels.slug } : {}),
    mode,
    platformId: import.meta.env.VITE_COURSEBOARD_PLATFORM_ID ?? RUNTIME_CONTEXT[mode].platformId,
    operatorId: import.meta.env.VITE_COURSEBOARD_OPERATOR_ID ?? id,
  }
}

function sessionUser(payload: SessionPayload): AuthUser | undefined {
  const user = payload.user
  if (!user) return undefined
  const email = user.email ?? undefined
  const name = user.name ?? user.username ?? email ?? 'Course Board user'
  const id = user.id ?? user.username ?? email
  if (!id) return undefined
  return { id, name, email, role: user.role ?? 'GENERAL' }
}

function httpsEndpoint(value: string, label: string) {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new AuthConfigurationError('ネイティブ認証の設定が不正です', `${label}がURLではありません。`)
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new AuthConfigurationError(
      'ネイティブ認証の設定が不正です',
      `${label}にはcredentialを含まないHTTPS URLが必要です。`,
    )
  }
  return endpoint.toString()
}

function nativeAuthConfiguration(): NativeAuthConfiguration {
  if (import.meta.env.VITE_COURSEBOARD_NATIVE_CLIENT_SECRET) {
    throw new AuthConfigurationError(
      'client secretをアプリへ埋め込めません',
      'VITE_COURSEBOARD_NATIVE_CLIENT_SECRETを削除し、PKCE対応public clientを使用してください。',
    )
  }

  const values = {
    authorizationEndpoint: import.meta.env.VITE_COURSEBOARD_NATIVE_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: import.meta.env.VITE_COURSEBOARD_NATIVE_TOKEN_ENDPOINT,
    profileEndpoint: import.meta.env.VITE_COURSEBOARD_NATIVE_PROFILE_ENDPOINT,
    clientId: import.meta.env.VITE_COURSEBOARD_NATIVE_CLIENT_ID,
    redirectUri: import.meta.env.VITE_COURSEBOARD_NATIVE_REDIRECT_URI,
  }
  const missing = Object.entries(values)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name)
  if (missing.length > 0 || import.meta.env.VITE_COURSEBOARD_NATIVE_DEEP_LINK_READY !== 'true') {
    throw new AuthConfigurationError(
      'ネイティブ認証の設定が必要です',
      'PKCE対応public client、profile BFF、courseboard://oauth/callback deep linkを配備し、native認証環境変数を設定してください。',
    )
  }

  const redirectUri = values.redirectUri as string
  if (redirectUri !== 'courseboard://oauth/callback') {
    throw new AuthConfigurationError(
      'ネイティブ認証のredirect URIが不正です',
      'VITE_COURSEBOARD_NATIVE_REDIRECT_URIはcourseboard://oauth/callbackに固定してください。',
    )
  }
  const scopes = (import.meta.env.VITE_COURSEBOARD_NATIVE_SCOPES ?? 'openid profile email')
    .split(/\s+/)
    .filter(Boolean)
  if (!scopes.includes('openid')) {
    throw new AuthConfigurationError(
      'ネイティブ認証のscopeが不正です',
      'VITE_COURSEBOARD_NATIVE_SCOPESにはopenidが必要です。',
    )
  }

  return {
    authorizationEndpoint: httpsEndpoint(values.authorizationEndpoint as string, 'authorization endpoint'),
    tokenEndpoint: httpsEndpoint(values.tokenEndpoint as string, 'token endpoint'),
    profileEndpoint: httpsEndpoint(values.profileEndpoint as string, 'profile endpoint'),
    clientId: (values.clientId as string).trim(),
    redirectUri,
    scopes,
  }
}

function browserPkceConfiguration(): BrowserPkceConfiguration {
  if (import.meta.env.VITE_COURSEBOARD_BROWSER_CLIENT_SECRET) {
    throw new AuthConfigurationError(
      'client secretをブラウザへ埋め込めません',
      'VITE_COURSEBOARD_BROWSER_CLIENT_SECRETを削除し、PKCE対応public clientを使用してください。',
    )
  }

  const clientId = import.meta.env.VITE_COURSEBOARD_BROWSER_CLIENT_ID?.trim()
  if (!clientId) {
    throw new AuthConfigurationError(
      'ブラウザ認証の設定が必要です',
      'TachyonでPKCE対応public clientを発行し、VITE_COURSEBOARD_BROWSER_CLIENT_IDを設定してください。',
    )
  }

  const redirectUri = import.meta.env.VITE_COURSEBOARD_BROWSER_REDIRECT_URI
    ?? 'http://127.0.0.1:5173/oauth/callback'
  const redirect = new URL(redirectUri)
  if (
    redirect.protocol !== 'http:'
    || redirect.hostname !== '127.0.0.1'
    || redirect.port !== '5173'
    || redirect.pathname !== '/oauth/callback'
  ) {
    throw new AuthConfigurationError(
      'ブラウザ認証のredirect URIが不正です',
      'ローカルViteではhttp://127.0.0.1:5173/oauth/callbackを使用してください。',
    )
  }

  const scopes = (import.meta.env.VITE_COURSEBOARD_BROWSER_SCOPES ?? 'openid profile email')
    .split(/\s+/)
    .filter(Boolean)
  if (!scopes.includes('openid')) {
    throw new AuthConfigurationError(
      'ブラウザ認証のscopeが不正です',
      'VITE_COURSEBOARD_BROWSER_SCOPESにはopenidが必要です。',
    )
  }

  return {
    loginEndpoint: httpsEndpoint(
      import.meta.env.VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT
        ?? 'https://api.n1.tachy.one/oauth2/login',
      'login endpoint',
    ),
    authorizationEndpoint: httpsEndpoint(
      import.meta.env.VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT
        ?? 'https://api.n1.tachy.one/oauth2/authorize',
      'authorization endpoint',
    ),
    tokenEndpoint: httpsEndpoint(
      import.meta.env.VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT
        ?? 'https://api.n1.tachy.one/oauth2/token',
      'token endpoint',
    ),
    profileEndpoint: import.meta.env.VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT
      ?? 'https://api.n1.tachy.one/v1/me',
    clientId,
    redirectUri,
    scopes,
  }
}

function nativeTenant(payload: NativeTenantPayload) {
  if (typeof payload === 'string') return envTenant(payload)
  if (!payload.id) return undefined
  const labels = envTenantLabels(payload.id)
  const rawName = payload.name?.trim()
  const rawSlug = payload.slug?.trim() || payload.alias?.trim() || undefined
  const fallback = envTenant(payload.id, rawName || labels.name || payload.id)
  const distinctName = rawName && rawName !== payload.id ? rawName : undefined
  return {
    ...fallback,
    name: distinctName || labels.name || rawName || fallback.name,
    slug: rawSlug || labels.slug || fallback.slug,
    mode: payload.mode ?? fallback.mode,
    platformId: payload.platformId ?? fallback.platformId,
    operatorId: payload.operatorId ?? fallback.operatorId,
  } satisfies AuthTenant
}

function authErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: string; message?: string }
    return payload.message?.trim() || payload.error?.trim() || fallback
  } catch {
    return fallback
  }
}

class WebSessionAdapter implements AuthAdapter {
  async bootstrap(): Promise<AuthBootstrapResult> {
    const response = await fetch('/api/auth/courseboard-context', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (response.status === 401) return { kind: 'anonymous' }
    if (!response.ok) throw new Error('認証セッションを確認できませんでした。')

    const payload = await response.json() as WebAuthContextPayload
    if (payload.error === 'RefreshAccessTokenError' || payload.error === 'VerifyAccessTokenError') {
      return { kind: 'anonymous', reason: 'expired' }
    }
    const user = sessionUser(payload)
    if (!user) return { kind: 'anonymous' }

    const tenants = (payload.tenants ?? payload.user?.tenants ?? [])
      .map(nativeTenant)
      .filter((tenant): tenant is AuthTenant => Boolean(tenant))
    return { kind: 'authenticated', user, tenants, partial: payload.partial }
  }

  async signIn(provider?: 'Google') {
    const target = new URL('/api/auth/signin/tachyon', window.location.origin)
    target.searchParams.set('callbackUrl', window.location.href)
    if (provider === 'Google') target.searchParams.set('identity_provider', 'Google')
    window.location.assign(target)
  }

  // Web keeps the Cognito token inside the same-origin BFF. The browser sends
  // only the HttpOnly Auth.js cookie to /field-api and never receives a raw
  // access token.
  async getAccessToken() { return undefined }

  async signOut(reason?: AuthReason) {
    const target = new URL('/auth/sign_out', window.location.origin)
    if (reason === 'expired') target.searchParams.set('error', 'expired')
    window.location.assign(target)
  }
}

class DevelopmentAdapter implements AuthAdapter {
  private readonly configuredToken = import.meta.env.VITE_COURSEBOARD_API_BEARER as string
  private token: string | undefined = this.configuredToken
  private lastSignOutReason?: AuthReason

  async bootstrap(): Promise<AuthBootstrapResult> {
    if (!this.token) {
      return { kind: 'anonymous', reason: this.lastSignOutReason }
    }
    const id = import.meta.env.VITE_COURSEBOARD_TENANT_ID ?? 'courseboard_id'
    const localName = usesLocalDemoTenantChrome()
      ? (import.meta.env.VITE_COURSEBOARD_TENANT_NAME?.trim() || id)
      : id
    return {
      kind: 'authenticated',
      user: {
        id: 'local-operator',
        name: 'Local operator',
        role: 'DEVELOPMENT',
      },
      tenants: [envTenant(id, localName)],
    }
  }

  async signIn() {
    // Restore the configured bearer so operators can retry after updating JWT
    // without a hard page reload.
    this.token = this.configuredToken
    this.lastSignOutReason = undefined
  }

  async getAccessToken() { return this.token }

  async signOut(reason?: AuthReason) {
    // Soft sign-out only. Hard reload re-bootstraps with the same invalid JWT,
    // which retriggers 401 → onUnauthorized → reload in a loop.
    this.token = undefined
    this.lastSignOutReason = reason
  }
}

/** platform-ui.session-style durable browser-pkce session (survives Vite HMR / hard refresh). */
export const BROWSER_PKCE_SESSION_KEY = 'courseboard.auth.browser.session'
/** Legacy refresh-only key (sessionStorage); migrated on read then removed. */
const BROWSER_PKCE_REFRESH_KEY_LEGACY = 'courseboard.auth.browser.refresh'

type BrowserPkceSession = {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt: number
}

class BrowserPkceAdapter implements AuthAdapter {
  private readonly configuration = browserPkceConfiguration()
  private accessToken?: string
  private accessTokenExpiresAt = 0
  private refreshToken?: string
  private tokenRequest?: Promise<string | undefined>

  constructor() {
    this.restoreSession()
  }

  async bootstrap(): Promise<AuthBootstrapResult> {
    if (!this.accessToken || Date.now() >= this.accessTokenExpiresAt - 60_000) {
      const refreshed = await this.getAccessToken()
      if (!refreshed) return { kind: 'anonymous' }
    }
    return this.loadProfile()
  }

  async signIn() {
    throw new NativeAuthorizationError('ユーザー名とパスワードを入力してください。')
  }

  async signInWithPassword(username: string, password: string) {
    const loginResponse = await fetch(this.configuration.loginEndpoint, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    })
    if (!loginResponse.ok) {
      throw new NativeAuthorizationError(await responseError(
        loginResponse,
        'ユーザー名またはパスワードを確認してください。',
      ))
    }
    const login = await loginResponse.json() as BrowserLoginPayload
    if (login.status === 'new_password_required' || login.session) {
      throw new NativeAuthorizationError(
        '初回パスワード変更が必要です。Tachyon Account Centerで変更してから、もう一度ログインしてください。',
      )
    }
    if (!login.session_token) {
      throw new NativeAuthorizationError('Tachyon Authからログインセッションを受信できませんでした。')
    }

    // platform-ui / ADR-0022: JSON authorize returns the code (no browser redirect).
    // redirect_uri is still required and must match the registered public client URI.
    const transaction = await createPkceTransaction(this.configuration.redirectUri)
    const authorizationResponse = await fetch(this.configuration.authorizationEndpoint, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${login.session_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.configuration.clientId,
        redirect_uri: this.configuration.redirectUri,
        response_type: 'code',
        scope: this.configuration.scopes.join(' '),
        state: transaction.state,
        code_challenge: transaction.challenge,
        code_challenge_method: 'S256',
      }),
    })
    if (!authorizationResponse.ok) {
      throw new NativeAuthorizationError(await responseError(
        authorizationResponse,
        'ログインセッションを認可codeへ交換できませんでした。',
      ))
    }
    const authorization = await authorizationResponse.json() as BrowserAuthorizationPayload
    if (!authorization.authorization_code) {
      throw new NativeAuthorizationError('Tachyon Authから認可codeを受信できませんでした。')
    }
    await this.exchangeToken({
      grant_type: 'authorization_code',
      client_id: this.configuration.clientId,
      redirect_uri: this.configuration.redirectUri,
      code: authorization.authorization_code,
      code_verifier: transaction.verifier,
    })
  }

  async getAccessToken(forceRefresh = false) {
    if (!this.accessToken && !this.refreshToken) {
      this.restoreSession()
    }
    const hasFreshToken = this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000
    if (!forceRefresh && hasFreshToken) return this.accessToken
    if (!this.refreshToken) return undefined
    if (this.tokenRequest) return this.tokenRequest

    this.tokenRequest = this.refreshAccessToken().finally(() => {
      this.tokenRequest = undefined
    })
    return this.tokenRequest
  }

  async signOut() {
    this.clearSession()
  }

  private restoreSession() {
    const session = readStoredBrowserSession()
    if (!session) return
    this.accessToken = session.accessToken || undefined
    this.accessTokenExpiresAt = session.accessTokenExpiresAt
    this.refreshToken = session.refreshToken
  }

  private persistSession() {
    if (!this.accessToken) {
      clearStoredBrowserSession()
      return
    }
    writeStoredBrowserSession({
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      accessTokenExpiresAt: this.accessTokenExpiresAt,
    })
  }

  private clearSession() {
    this.accessToken = undefined
    this.accessTokenExpiresAt = 0
    this.refreshToken = undefined
    clearStoredBrowserSession()
  }

  private async refreshAccessToken() {
    if (!this.refreshToken) return undefined
    try {
      await this.exchangeToken({
        grant_type: 'refresh_token',
        client_id: this.configuration.clientId,
        refresh_token: this.refreshToken,
      }, this.refreshToken)
      return this.accessToken
    } catch {
      this.clearSession()
      return undefined
    }
  }

  private async exchangeToken(
    body: Record<string, string>,
    existingRefreshToken?: string,
  ) {
    const response = await fetch(this.configuration.tokenEndpoint, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new NativeAuthorizationError('認証codeをtokenへ交換できませんでした。')
    const payload = await response.json() as NativeTokenPayload
    if (!payload.access_token || (payload.token_type && payload.token_type.toLowerCase() !== 'bearer')) {
      throw new NativeAuthorizationError('token endpointから有効なBearer tokenが返りませんでした。')
    }
    this.accessToken = payload.access_token
    this.accessTokenExpiresAt = jwtExpiry(payload.access_token)
      ?? Date.now() + Math.max(60, Number(payload.expires_in) || 300) * 1000
    this.refreshToken = payload.refresh_token ?? existingRefreshToken
    this.persistSession()
  }

  private async loadProfile(): Promise<AuthBootstrapResult> {
    if (!this.accessToken) return { kind: 'anonymous' }
    const response = await fetch(this.configuration.profileEndpoint, {
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
    })
    if (response.status === 401) {
      // Access may be stale after restore; try one refresh before giving up.
      const refreshed = await this.getAccessToken(true)
      if (refreshed) {
        const retry = await fetch(this.configuration.profileEndpoint, {
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${refreshed}`,
          },
        })
        if (retry.ok) {
          return this.profileFromResponse(retry)
        }
        if (retry.status !== 401) throw new Error('ブラウザ認証profileを取得できませんでした。')
      }
      this.clearSession()
      return { kind: 'anonymous', reason: 'expired' }
    }
    if (!response.ok) throw new Error('ブラウザ認証profileを取得できませんでした。')
    return this.profileFromResponse(response)
  }

  private async profileFromResponse(response: Response): Promise<AuthBootstrapResult> {
    const payload = await response.json() as NativeProfilePayload
    const user = sessionUser(payload)
    if (!user) throw new Error('ブラウザ認証profileにユーザー情報がありません。')
    const tenantPayloads = payload.tenants ?? payload.user?.tenants ?? []
    let tenants = tenantPayloads.map(nativeTenant).filter((tenant): tenant is AuthTenant => Boolean(tenant))
    // Local course-api → prod Field still needs a tn_… operator id even when
    // /v1/me returns an empty tenant list for the signed-in user.
    if (tenants.length === 0) {
      const fallbackId = import.meta.env.VITE_COURSEBOARD_TENANT_ID?.trim()
      if (fallbackId) {
        const fallbackName = usesLocalDemoTenantChrome()
          ? (import.meta.env.VITE_COURSEBOARD_TENANT_NAME?.trim() || fallbackId)
          : fallbackId
        tenants = [envTenant(fallbackId, fallbackName)]
      }
    }
    return { kind: 'authenticated', user, tenants, partial: payload.partial }
  }
}

function readStoredBrowserSession(): BrowserPkceSession | undefined {
  try {
    const raw = localStorage.getItem(BROWSER_PKCE_SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrowserPkceSession>
      if (
        typeof parsed.accessToken === 'string'
        && typeof parsed.accessTokenExpiresAt === 'number'
      ) {
        return {
          accessToken: parsed.accessToken,
          refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
          accessTokenExpiresAt: parsed.accessTokenExpiresAt,
        }
      }
      localStorage.removeItem(BROWSER_PKCE_SESSION_KEY)
    }

    // One-time migration from refresh-only sessionStorage (cleared after persist).
    const legacyRefresh = sessionStorage.getItem(BROWSER_PKCE_REFRESH_KEY_LEGACY) ?? undefined
    if (legacyRefresh) {
      return {
        accessToken: '',
        refreshToken: legacyRefresh,
        accessTokenExpiresAt: 0,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

function writeStoredBrowserSession(session: BrowserPkceSession) {
  try {
    localStorage.setItem(BROWSER_PKCE_SESSION_KEY, JSON.stringify(session))
    sessionStorage.removeItem(BROWSER_PKCE_REFRESH_KEY_LEGACY)
  } catch {
    // Ignore quota / private-mode failures; in-memory token still works for the tab.
  }
}

function clearStoredBrowserSession() {
  try {
    localStorage.removeItem(BROWSER_PKCE_SESSION_KEY)
    sessionStorage.removeItem(BROWSER_PKCE_REFRESH_KEY_LEGACY)
  } catch {
    // Ignore storage failures during sign-out.
  }
}

class NativePkceAdapter implements AuthAdapter {
  private readonly configuration = nativeAuthConfiguration()
  private accessToken?: string
  private accessTokenExpiresAt = 0
  private refreshToken?: string
  private tokenRequest?: Promise<string | undefined>
  private capabilities?: NativeAuthCapabilities

  async bootstrap(): Promise<AuthBootstrapResult> {
    await this.ensureNativeBridge()
    const callback = await this.takeCallback()
    if (callback) await this.completeAuthorization(callback)
    if (!this.accessToken || Date.now() >= this.accessTokenExpiresAt - 60_000) {
      const refreshed = await this.getAccessToken()
      if (!refreshed) return { kind: 'anonymous' }
    }
    return this.loadProfile()
  }

  async signIn(provider?: 'Google') {
    await this.ensureNativeBridge()
    const transaction = await createPkceTransaction(this.configuration.redirectUri)
    localStorage.setItem(NATIVE_AUTH_PENDING_KEY, JSON.stringify(transaction))

    const authorizationUrl = new URL(this.configuration.authorizationEndpoint)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('client_id', this.configuration.clientId)
    authorizationUrl.searchParams.set('redirect_uri', this.configuration.redirectUri)
    authorizationUrl.searchParams.set('scope', this.configuration.scopes.join(' '))
    authorizationUrl.searchParams.set('state', transaction.state)
    authorizationUrl.searchParams.set('code_challenge', transaction.challenge)
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')
    if (provider === 'Google') authorizationUrl.searchParams.set('identity_provider', 'Google')

    try {
      await invoke('native_auth_open_authorization_url', { url: authorizationUrl.toString() })
      const callback = await this.waitForCallback()
      await this.completeAuthorization(callback)
    } catch (error) {
      localStorage.removeItem(NATIVE_AUTH_PENDING_KEY)
      if (error instanceof NativeAuthorizationError || error instanceof AuthConfigurationError) throw error
      throw new Error(`ネイティブログインを開始できませんでした: ${authErrorMessage(error)}`)
    }
  }

  async getAccessToken(forceRefresh = false) {
    const hasFreshToken = this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000
    if (!forceRefresh && hasFreshToken) return this.accessToken
    if (!this.refreshToken) return undefined
    if (this.tokenRequest) return this.tokenRequest

    this.tokenRequest = this.refreshAccessToken().finally(() => {
      this.tokenRequest = undefined
    })
    return this.tokenRequest
  }

  async signOut() {
    this.accessToken = undefined
    this.accessTokenExpiresAt = 0
    this.refreshToken = undefined
    localStorage.removeItem(NATIVE_AUTH_PENDING_KEY)
  }

  private async ensureNativeBridge() {
    if (!this.capabilities) {
      this.capabilities = await invoke<NativeAuthCapabilities>('native_auth_capabilities')
    }
    if (!this.capabilities.externalBrowser) {
      throw new AuthConfigurationError(
        'Mobile認証bridgeが必要です',
        `現在のcallback modeは${this.capabilities.callbackMode}です。Tauri opener/deep-linkとOS secure storageを配備してください。`,
      )
    }
  }

  private pendingTransaction() {
    const serialized = localStorage.getItem(NATIVE_AUTH_PENDING_KEY)
    if (!serialized) throw new NativeAuthorizationError('対応するログイン要求がありません。')
    try {
      const transaction = JSON.parse(serialized) as Partial<PkceTransaction>
      if (
        typeof transaction.state !== 'string'
        || typeof transaction.verifier !== 'string'
        || typeof transaction.redirectUri !== 'string'
        || typeof transaction.createdAt !== 'number'
      ) {
        throw new Error('invalid pending transaction')
      }
      return transaction as PkceTransaction
    } catch {
      localStorage.removeItem(NATIVE_AUTH_PENDING_KEY)
      throw new NativeAuthorizationError('保存されたログイン要求が不正です。')
    }
  }

  private async takeCallback() {
    if (window.location.href.startsWith(this.configuration.redirectUri)) return window.location.href
    return invoke<string | null>('native_auth_take_callback')
  }

  private async waitForCallback() {
    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      const callback = await this.takeCallback()
      if (callback) return callback
      await new Promise(resolve => window.setTimeout(resolve, 500))
    }
    throw new NativeAuthorizationError('ログイン応答を受信できませんでした。もう一度ログインしてください。')
  }

  private async completeAuthorization(callbackUrl: string) {
    const transaction = this.pendingTransaction()
    let code: string
    try {
      code = parseAuthorizationCallback(callbackUrl, transaction)
    } finally {
      localStorage.removeItem(NATIVE_AUTH_PENDING_KEY)
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.configuration.clientId,
      redirect_uri: this.configuration.redirectUri,
      code,
      code_verifier: transaction.verifier,
    })
    await this.exchangeToken(body)
  }

  private async refreshAccessToken() {
    if (!this.refreshToken) return undefined
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.configuration.clientId,
      refresh_token: this.refreshToken,
    })
    await this.exchangeToken(body, this.refreshToken)
    return this.accessToken
  }

  private async exchangeToken(body: URLSearchParams, existingRefreshToken?: string) {
    const response = await fetch(this.configuration.tokenEndpoint, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!response.ok) throw new NativeAuthorizationError('認証codeをtokenへ交換できませんでした。')
    const payload = await response.json() as NativeTokenPayload
    if (!payload.access_token || (payload.token_type && payload.token_type.toLowerCase() !== 'bearer')) {
      throw new NativeAuthorizationError('token endpointから有効なBearer tokenが返りませんでした。')
    }
    this.accessToken = payload.access_token
    this.accessTokenExpiresAt = jwtExpiry(payload.access_token)
      ?? Date.now() + Math.max(60, Number(payload.expires_in) || 300) * 1000
    this.refreshToken = payload.refresh_token ?? existingRefreshToken
  }

  private async loadProfile(): Promise<AuthBootstrapResult> {
    if (!this.accessToken) return { kind: 'anonymous' }
    const response = await fetch(this.configuration.profileEndpoint, {
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
    })
    if (response.status === 401) {
      await this.signOut()
      return { kind: 'anonymous', reason: 'expired' }
    }
    if (!response.ok) throw new Error('ネイティブ認証profileを取得できませんでした。')

    const payload = await response.json() as NativeProfilePayload
    const user = sessionUser(payload)
    if (!user) throw new Error('ネイティブ認証profileにユーザー情報がありません。')
    const tenantPayloads = payload.tenants ?? payload.user?.tenants ?? []
    const tenants = tenantPayloads.map(nativeTenant).filter((tenant): tenant is AuthTenant => Boolean(tenant))
    return { kind: 'authenticated', user, tenants, partial: payload.partial }
  }
}

function jwtExpiry(token: string) {
  try {
    const encoded = token.split('.')[1]
    if (!encoded) return undefined
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized)) as { exp?: number }
    return payload.exp ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

export function createAuthAdapter(): AuthAdapter {
  if (import.meta.env.VITE_COURSEBOARD_AUTH_MODE === 'development') {
    if (!import.meta.env.VITE_COURSEBOARD_API_BEARER) {
      throw new AuthConfigurationError(
        '開発認証を開始できません',
        'VITE_COURSEBOARD_AUTH_MODE=development ではVITE_COURSEBOARD_API_BEARERが必要です。',
      )
    }
    return new DevelopmentAdapter()
  }
  if (import.meta.env.VITE_COURSEBOARD_AUTH_MODE === 'browser-pkce') {
    return new BrowserPkceAdapter()
  }
  return platformKind() === 'web' ? new WebSessionAdapter() : new NativePkceAdapter()
}
