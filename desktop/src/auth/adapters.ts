import { invoke } from '@tauri-apps/api/core'
import {
  CognitoRequestError,
  authenticateWithCognito,
  refreshCognitoTokens,
} from './cognito'
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

type NativeAuthConfiguration = {
  authorizationEndpoint: string
  tokenEndpoint: string
  profileEndpoint: string
  clientId: string
  redirectUri: string
  scopes: string[]
}

type BrowserPkceConfiguration = {
  cognitoEndpoint: string
  profileEndpoint: string
  clientId: string
}

type NativeAuthCapabilities = {
  externalBrowser: boolean
  callbackMode: string
}

type NativeTokenPayload = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
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
    throw new AuthConfigurationError('認証設定が不正です', `${label}がURLではありません。`)
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new AuthConfigurationError(
      '認証設定が不正です',
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
      'VITE_COURSEBOARD_BROWSER_CLIENT_SECRETを削除し、secretなしCognito public clientを使用してください。',
    )
  }

  const clientId = import.meta.env.VITE_COURSEBOARD_BROWSER_CLIENT_ID?.trim()
  if (!clientId) {
    throw new AuthConfigurationError(
      'ブラウザ認証の設定が必要です',
      'TachyonでsecretなしCognito public clientを発行し、VITE_COURSEBOARD_BROWSER_CLIENT_IDを設定してください。',
    )
  }
  const region = import.meta.env.VITE_COURSEBOARD_COGNITO_REGION?.trim()
    || 'ap-northeast-1'

  return {
    cognitoEndpoint: httpsEndpoint(
      `https://cognito-idp.${region}.amazonaws.com/`,
      'Cognito endpoint',
    ),
    profileEndpoint: import.meta.env.VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT
      ?? 'https://api.n1.tachy.one/v1/me',
    clientId,
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

/** Access tokens within the refresh skew window are still usable for API calls. */
function isFreshAccessToken(accessToken: string | undefined, expiresAt: number): accessToken is string {
  return Boolean(accessToken && Date.now() < expiresAt - 60_000)
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

/** Durable Cognito session; the legacy key is retained across the issuer migration. */
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
      if (!refreshed) {
        // Still holding durable tokens after a failed refresh — try /v1/me (and let
        // loadProfile distinguish transient errors from confirmed expiry).
        if (!this.accessToken && !this.refreshToken) return { kind: 'anonymous' }
      }
    }
    return this.loadProfile()
  }

  async signIn() {
    throw new NativeAuthorizationError('ユーザー名とパスワードを入力してください。')
  }

  async signInWithPassword(username: string, password: string) {
    const result = await authenticateWithCognito(
      this.configuration.cognitoEndpoint,
      this.configuration.clientId,
      username.trim(),
      password,
    )
    if (result.status === 'new_password_required') {
      throw new NativeAuthorizationError(
        '初回パスワード変更が必要です。Tachyon Account Centerで変更してから、もう一度ログインしてください。',
      )
    }
    this.acceptCognitoTokens(result.tokens)
  }

  async getAccessToken(forceRefresh = false) {
    // Rehydrate when either side of the pair is missing (memory/storage skew).
    if (!this.accessToken || !this.refreshToken) {
      this.restoreSession()
    }
    const hasFreshToken = isFreshAccessToken(this.accessToken, this.accessTokenExpiresAt)
    if (!forceRefresh && hasFreshToken) return this.accessToken
    if (!this.refreshToken) {
      // 401 recovery calls forceRefresh=true; keep a still-valid access token when
      // the client has no refresh token (common for some Cognito public clients).
      return hasFreshToken ? this.accessToken : undefined
    }
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
      const tokens = await refreshCognitoTokens(
        this.configuration.cognitoEndpoint,
        this.configuration.clientId,
        this.refreshToken,
      )
      this.acceptCognitoTokens(tokens, this.refreshToken)
      return this.accessToken
    } catch (error) {
      if (error instanceof CognitoRequestError && error.definitive) {
        // Drop only the dead refresh grant; keep a still-fresh access token so a
        // spurious API 401 does not soft-sign-out a valid session.
        this.refreshToken = undefined
        if (!isFreshAccessToken(this.accessToken, this.accessTokenExpiresAt)) {
          this.clearSession()
          return undefined
        }
        this.persistSession()
        return this.accessToken
      }
      // Network / 5xx: keep durable tokens and fall back to the current access token
      // (even if slightly stale) so navigation does not soft-sign-out on a blip.
      if (!this.accessToken) this.restoreSession()
      return this.accessToken
    }
  }

  private acceptCognitoTokens(
    tokens: {
      accessToken: string
      refreshToken?: string
      expiresIn: number
    },
    existingRefreshToken?: string,
  ) {
    this.accessToken = tokens.accessToken
    this.accessTokenExpiresAt = jwtExpiry(tokens.accessToken)
      ?? Date.now() + Math.max(60, Number(tokens.expiresIn) || 300) * 1000
    this.refreshToken = tokens.refreshToken ?? existingRefreshToken
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
      const hadRefreshToken = Boolean(this.refreshToken)
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
        // Fresh token still rejected — not a local session expiry.
        throw new Error('ブラウザ認証profileを取得できませんでした。')
      }
      if (hadRefreshToken && this.refreshToken) {
        // Refresh failed transiently; keep tokens and surface a recoverable error.
        throw new Error('ブラウザ認証profileを取得できませんでした。')
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

/** @deprecated Course Board uses the shared React JSON PKCE form on every platform. */
export class NativePkceAdapter implements AuthAdapter {
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
    const hasFreshToken = isFreshAccessToken(this.accessToken, this.accessTokenExpiresAt)
    if (!forceRefresh && hasFreshToken) return this.accessToken
    if (!this.refreshToken) {
      return hasFreshToken ? this.accessToken : undefined
    }
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

function envTrimmed(value: string | undefined): string {
  return value?.trim() ?? ''
}

function browserPkceClientConfigured() {
  // Blank / whitespace-only overlays (KEY=) must count as unset so mode-local
  // empty overrides of `.env.local` do not look like a configured Cognito client.
  return Boolean(envTrimmed(import.meta.env.VITE_COURSEBOARD_BROWSER_CLIENT_ID))
}

/**
 * Pick the auth adapter from an explicit mode.
 *
 * Never silently fall back to DevelopmentAdapter ("Local operator") when a
 * Cognito public client is also configured — that usually means a process
 * env override stomped desktop/.env.local. Fail visibly instead.
 */
export function createAuthAdapter(): AuthAdapter {
  const authMode = envTrimmed(import.meta.env.VITE_COURSEBOARD_AUTH_MODE)
  const browserClientConfigured = browserPkceClientConfigured()
  const developmentBearer = envTrimmed(import.meta.env.VITE_COURSEBOARD_API_BEARER)

  if (authMode === 'cognito-direct' || authMode === 'browser-pkce') {
    return new BrowserPkceAdapter()
  }

  if (authMode === 'development') {
    // Only a non-empty browser client id conflicts with development + bearer.
    if (browserClientConfigured) {
      throw new AuthConfigurationError(
        '認証モードが衝突しています',
        'VITE_COURSEBOARD_AUTH_MODE=development と Cognito client id が同時に設定されています。'
          + ' Reactログインを使う場合は AUTH_MODE=cognito-direct にし、'
          + ' 開発用 VITE_COURSEBOARD_API_BEARER を外してください。'
          + ' CLI JWT / prod-api --login cli を使う場合は npm run prod-api:env または field:env で'
          + ' VITE_COURSEBOARD_BROWSER_*= の空上書きを書き直してください。',
      )
    }
    if (!developmentBearer) {
      throw new AuthConfigurationError(
        '開発認証を開始できません',
        'VITE_COURSEBOARD_AUTH_MODE=development ではVITE_COURSEBOARD_API_BEARERが必要です。',
      )
    }
    return new DevelopmentAdapter()
  }

  // Web and Tauri authenticate directly with a secretless Cognito public
  // client. Authentication stays inside React and never opens Hosted UI.
  if (browserClientConfigured) {
    return new BrowserPkceAdapter()
  }

  return new BrowserPkceAdapter()
}
