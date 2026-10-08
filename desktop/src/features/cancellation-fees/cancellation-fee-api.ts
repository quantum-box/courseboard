import { fieldApiJson } from '../../api'

export const CANCELLATION_FEES_PATH = '/v1/cancellation-fees'
export const CANCELLATION_FEE_CONTEXT_PATH = `${CANCELLATION_FEES_PATH}/context`

export type CancellationFeeContext = {
  tenantName?: string
  timezone?: string
}

export type CancellationFeeBillTo = {
  name: string
  phone?: string
  email?: string
}

export type CancellationFeeLineItem = {
  description: string
  quantity: number
  unitPrice: number
  taxCategory?: string
}

export type CreateCancellationFeeRequest = {
  idempotencyKey: string
  billTo: CancellationFeeBillTo
  lineItems: CancellationFeeLineItem[]
  dueDate: string
  currency?: string
  taxCategory?: string
  taxAmount?: number
  notes?: string
  createPaymentLink?: boolean
  paymentLinkProvider?: 'stripe' | 'square'
  sendEmail?: boolean
  sendSms?: boolean
}

export type SendCancellationFeeRequest = {
  idempotencyKey: string
  sendEmail?: boolean
  sendSms?: boolean
}

export type CancellationFeeListQuery = {
  status?: string
  limit?: number
  offset?: number
}

export function getCancellationFeeContext<T = CancellationFeeContext>() {
  return fieldApiJson<T>(CANCELLATION_FEE_CONTEXT_PATH)
}

function cancellationFeePath(invoiceId: string, suffix = '') {
  return `${CANCELLATION_FEES_PATH}/${encodeURIComponent(invoiceId)}${suffix}`
}

export function listCancellationFees<T = unknown>(query: CancellationFeeListQuery = {}) {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const search = params.toString()
  return fieldApiJson<T>(`${CANCELLATION_FEES_PATH}${search ? `?${search}` : ''}`)
}

export function getCancellationFee<T = unknown>(invoiceId: string) {
  return fieldApiJson<T>(cancellationFeePath(invoiceId))
}

export function createCancellationFee<T = unknown>(body: CreateCancellationFeeRequest) {
  return fieldApiJson<T>(CANCELLATION_FEES_PATH, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCancellationFee<T = unknown>(
  invoiceId: string,
  body: { notes?: string; clientEmail?: string },
) {
  return fieldApiJson<T>(cancellationFeePath(invoiceId), {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function fulfillCancellationFee<T = unknown>(invoiceId: string) {
  return fieldApiJson<T>(cancellationFeePath(invoiceId, '/fulfill'), {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function sendCancellationFee<T = unknown>(invoiceId: string, body: SendCancellationFeeRequest) {
  return fieldApiJson<T>(cancellationFeePath(invoiceId, '/send'), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** The dedicated API requires UUID-shaped keys so an accidental arbitrary value cannot become an invoice number. */
export function newCancellationFeeIdempotencyKey() {
  const key = crypto.randomUUID().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    throw new Error('Unable to create a valid cancellation-fee idempotency key')
  }
  return key
}
