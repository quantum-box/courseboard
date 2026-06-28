export type CancellationFeeCollection = {
  id: string
  tenant_id: string
  reference?: string | null
  customer_name: string
  amount: number
  currency: string
  due_date: string
  reason?: string | null
  payment_url: string
  field_invoice_id?: string | null
  status: 'pending' | 'paid' | 'cancelled' | 'expired' | string
  sms_status: 'not_requested' | 'skipped' | 'sent' | 'failed' | string
  paid_at?: string | null
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

const fieldContext = new URLSearchParams(window.location.search)

export function operatorApiBaseUrl() {
  const proxyBase = fieldContext.get('proxyBase')
  if (proxyBase) return proxyBase
  return import.meta.env.VITE_COURSEBOARD_API_BASE_URL ?? ''
}

export function publicApiBaseUrl() {
  return import.meta.env.VITE_COURSEBOARD_PUBLIC_API_BASE_URL
    ?? import.meta.env.VITE_COURSEBOARD_API_BASE_URL
    ?? ''
}

export function fieldTenant() {
  return fieldContext.get('tenant') ?? import.meta.env.VITE_COURSEBOARD_TENANT_ID ?? 'scc'
}

export async function apiJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }
  const localBearer = import.meta.env.VITE_COURSEBOARD_API_BEARER
  if (localBearer && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${localBearer}`)
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const text = await response.text()
    let message: string | undefined
    try {
      const body = JSON.parse(text) as { message?: string; error?: string }
      message = body.message ?? body.error
    } catch {
      message = undefined
    }
    throw new Error(message ?? (text || `Request failed with ${response.status}`))
  }
  return response.json() as Promise<T>
}

export function yen(amount: number) {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount)
}
