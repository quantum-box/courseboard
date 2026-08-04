import { i18next } from './i18n'

import {
  resolveMockFieldApiJson,
  resolveMockFieldApiText,
  type MockFieldResult,
} from './dev/mockFieldApi'

export type CancellationFeeCollection = {
  id: string
  tenant_id: string
  reference?: string | null
  customer_name: string
  customer_phone?: string | null
  amount: number
  currency: string
  due_date: string
  reason?: string | null
  payment_url: string
  field_invoice_id?: string | null
  status: 'pending' | 'paid' | 'cancelled' | 'expired' | string
  sms_status: 'not_requested' | 'skipped' | 'sent' | 'failed' | string
  paid_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type CreateCollectionResponse = {
  collection: CancellationFeeCollection
  sms_message: string
}

export type StripePaymentIntentResponse = {
  publishable_key: string
  client_secret: string
  payment_intent_id: string
}

export type CancellationFeeCollectionList = {
  items: CancellationFeeCollection[]
}

export class ApiError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export type ApiAuthContext = {
  tenantId: string
  operatorId: string
  platformId: string
  getAccessToken(forceRefresh?: boolean): Promise<string | undefined>
  onUnauthorized(): void
  onForbidden(): void
}

let apiAuthContext: ApiAuthContext | null = null

export function configureApiAuth(context: ApiAuthContext | null) {
  apiAuthContext = context
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function operatorApiBaseUrl() {
  const configured = trimTrailingSlash(import.meta.env.VITE_COURSEBOARD_API_BASE_URL ?? '')
  if (!configured) return ''

  const target = new URL(configured, window.location.origin)
  if (target.protocol !== 'https:' && !import.meta.env.DEV) {
    throw new ApiError('本番APIにはHTTPS URLが必要です', 500)
  }
  return configured
}

export function publicApiBaseUrl() {
  return trimTrailingSlash(
    import.meta.env.VITE_COURSEBOARD_PUBLIC_API_BASE_URL
      ?? import.meta.env.VITE_COURSEBOARD_API_BASE_URL
      ?? '',
  )
}

export function fieldTenant() {
  return apiAuthContext?.tenantId
    ?? import.meta.env.VITE_COURSEBOARD_TENANT_ID
    ?? (import.meta.env.DEV ? 'courseboard_id' : '')
}

export function fieldPlatformId() {
  return apiAuthContext?.platformId
    ?? import.meta.env.VITE_COURSEBOARD_PLATFORM_ID
    ?? (import.meta.env.DEV ? 'tn_01hjjn348rn3t49zz6hvmfq67p' : '')
}

function requestHeaders(init?: RequestInit, token?: string) {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }
  const operatorId = apiAuthContext?.operatorId ?? fieldTenant()
  const platformId = fieldPlatformId()
  if (operatorId && !headers.has('x-operator-id')) {
    headers.set('x-operator-id', operatorId)
  }
  if (platformId && !headers.has('x-platform-id')) {
    headers.set('x-platform-id', platformId)
  }

  const developmentBearer = import.meta.env.VITE_COURSEBOARD_AUTH_MODE === 'development'
    ? import.meta.env.VITE_COURSEBOARD_API_BEARER
    : undefined
  const bearer = token ?? developmentBearer
  if (bearer && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${bearer}`)
  }
  if (bearer && !headers.has('x-courseboard-authorization')) {
    headers.set('x-courseboard-authorization', `Bearer ${bearer}`)
  }
  return headers
}

function publicRequestHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

function join(baseUrl: string, path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${normalizedPath}`
}

export function protectedRequestCredentials(
  requestUrl: string,
  currentOrigin: string,
  isNative: boolean,
): RequestCredentials {
  const targetOrigin = new URL(requestUrl, currentOrigin).origin
  return !isNative && targetOrigin === currentOrigin ? 'include' : 'omit'
}

async function parseError(response: Response) {
  const raw = await response.text()
  if (!raw) return new ApiError(`Request failed with ${response.status}`, response.status)
  try {
    const body = JSON.parse(raw) as {
      message?: string
      error?: string | { message?: string }
    }
    const nested = typeof body.error === 'object' ? body.error?.message : body.error
    return new ApiError(
      body.message ?? nested ?? `Request failed with ${response.status}`,
      response.status,
      body,
    )
  } catch {
    return new ApiError(raw, response.status)
  }
}

export async function apiJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(join(baseUrl, path), {
    ...init,
    credentials: init?.credentials ?? 'omit',
    headers: publicRequestHeaders(init),
  })
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  const raw = await response.text()
  if (!raw) return undefined as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new ApiError('API response was not valid JSON', 502, raw)
  }
}

/**
 * Soft-sign-out only when a 401 cannot be recovered by refreshing the access token.
 * A 401 after a successful refresh is a request/authorization failure, not session
 * expiry — navigation must not flash "Your session expired".
 */
export function shouldSoftSignOutOn401(input: {
  hasAuthContext: boolean
  alreadyRetried: boolean
  refreshProducedToken: boolean
}): boolean {
  if (!input.hasAuthContext) return false
  if (input.alreadyRetried) return false
  return !input.refreshProducedToken
}

async function accessTokenForProtectedRequest() {
  const context = apiAuthContext
  if (!context) {
    throw new ApiError(i18next.t('common:error.authNotReady'), 401)
  }

  const current = await context.getAccessToken(false)
  if (current) return current

  const refreshed = await context.getAccessToken(true)
  if (refreshed) return refreshed

  context.onUnauthorized()
  throw new ApiError(i18next.t('common:error.sessionExpired'), 401)
}

async function protectedFetch(
  path: string,
  init?: RequestInit,
  retried = false,
  tokenOverride?: string,
) {
  const token = tokenOverride ?? await accessTokenForProtectedRequest()
  const requestUrl = join(operatorApiBaseUrl(), path)
  const isNative = '__TAURI_INTERNALS__' in window
  const defaultCredentials = protectedRequestCredentials(
    requestUrl,
    window.location.origin,
    isNative,
  )
  const response = await fetch(requestUrl, {
    ...init,
    credentials: init?.credentials ?? defaultCredentials,
    headers: requestHeaders(init, token),
  })

  if (response.status === 401) {
    if (!retried && apiAuthContext) {
      const refreshed = await apiAuthContext.getAccessToken(true)
      if (refreshed) return protectedFetch(path, init, true, refreshed)
      if (shouldSoftSignOutOn401({
        hasAuthContext: true,
        alreadyRetried: false,
        refreshProducedToken: false,
      })) {
        apiAuthContext.onUnauthorized()
      }
    }
    // Already retried with a refreshed token (or no auth context): surface the
    // 401 to the caller without treating it as session expiry.
  }
  if (
    response.status === 403
    && response.headers.get('x-courseboard-auth-denial') === 'tenant'
  ) {
    apiAuthContext?.onForbidden()
  }
  return response
}

async function protectedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(path, init)
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  const raw = await response.text()
  if (!raw) return undefined as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new ApiError('API response was not valid JSON', 502, raw)
  }
}

export async function courseboardApiJson<T>(path: string, init?: RequestInit) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  // Course-domain mocks share the development fixture gate with Field mocks.
  if (normalized.startsWith('/v1/course/')) {
    const mocked = unwrapMockResult(resolveMockFieldApiJson(normalized, init))
    if (mocked !== undefined) return mocked as T
  }
  return protectedJson<T>(normalized, init)
}

export async function courseboardApiText(path: string, init?: RequestInit) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  if (normalized.startsWith('/v1/course/')) {
    const mocked = unwrapMockResult(resolveMockFieldApiText(normalized, init))
    if (mocked !== undefined) return mocked
  }
  const response = await protectedFetch(normalized, init)
  if (!response.ok) throw await parseError(response)
  return response.text()
}

function unwrapMockResult<T>(result: MockFieldResult<T>): T | undefined {
  if (result.kind === 'disabled') return undefined
  if (result.kind === 'error') throw new ApiError(result.message, result.status)
  return result.data
}

export async function fieldApiJson<T>(path: string, init?: RequestInit) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const mocked = unwrapMockResult(resolveMockFieldApiJson(normalized, init))
  if (mocked !== undefined) return mocked as T
  return protectedJson<T>(`/field-api${normalized}`, init)
}

export async function fieldApiText(path: string, init?: RequestInit) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const mocked = unwrapMockResult(resolveMockFieldApiText(normalized, init))
  if (mocked !== undefined) return mocked
  const response = await protectedFetch(`/field-api${normalized}`, init)
  if (!response.ok) throw await parseError(response)
  return response.text()
}

export async function downloadBlob(filename: string, blob: Blob) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent)
  if (mobile && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

export function downloadText(filename: string, contents: string, type = 'text/csv;charset=utf-8') {
  void downloadBlob(filename, new Blob([contents], { type }))
}

export function yen(amount: number, currency = 'JPY') {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(amount)
}

/**
 * The wall clock the courses run on. Every "today" and "now" in the operator
 * screens is this clock, never the device's — a laptop left on a foreign
 * timezone must still show the day the course is actually working.
 */
export const COURSE_TIME_ZONE = 'Asia/Tokyo'

export function today() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: COURSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Current course-local time as `YYYY-MM-DDTHH:mm`, recomputed on every call. */
export function nowIsoMinute() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: COURSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(' ', 'T')
}

export function currentYearMonth() {
  return today().slice(0, 7)
}
