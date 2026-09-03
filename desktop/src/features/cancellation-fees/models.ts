/**
 * The invoice shapes a cancellation fee is raised as.
 *
 * Held apart from the screen because two screens now raise one: the fee page
 * itself, where somebody types a single invoice, and the cancellation
 * extraction in the customer ledger, which bills a morning's worth at once.
 * The body they send has to be the same one — a second spelling of `billTo` or
 * of the marker in `notes` is a second kind of invoice that only one screen can
 * find again.
 */

/** Who Field bills: a person in the ledger, or a company account. */
export type InvoiceBillTo =
  | { kind: 'customer'; customerId: string }
  | { kind: 'client'; clientId: string; affiliationId: string }

/**
 * One record an invoice was raised from (PLT-4158, tachyonfield#1291).
 *
 * `sourceType` is a closed set of Field's own record kinds; `reason` is an
 * opaque label Field stores and filters without ever interpreting. A
 * cancellation fee and a late-delivery penalty are the same shape upstream —
 * what the label means is ours.
 */
export type InvoiceSource = {
  sourceType: 'reservation' | 'order' | 'subscription' | 'quotation' | 'contract'
  sourceId: string
  reason?: string | null
}

export type CancellationFeeInvoiceRequestInput = {
  billTo: InvoiceBillTo
  /** The cancelled bookings this invoice is for. Omitted, nothing changes. */
  sources?: InvoiceSource[]
  clientName: string
  clientEmail?: string
  clientPhone?: string
  dueDate: string
  taxAmount: number
  notes: string
  description: string
  amount: number
  sendEmail: boolean
  sendSms: boolean
  smsMessage?: string
}

/**
 * The marker that makes an ordinary Field invoice findable as a cancellation
 * fee. Field has no invoice type for it, so the list filters on this.
 */
export const CANCELLATION_FEE_MARKER = '[courseboard:cancellation-fee]'

/**
 * The label CourseBoard puts on a cancellation-fee source.
 *
 * Field never reads it — `?reason=cancellation_fee` is an exact-match filter
 * over a string it stores verbatim. Keeping it snake_case matches how the
 * other opaque labels in Field's own examples are spelled, and it has to stay
 * stable: changing it orphans every invoice already carrying the old one.
 */
export const CANCELLATION_FEE_REASON = 'cancellation_fee'

/** Field's cap on how many records one invoice may declare (PLT-4158). */
export const INVOICE_SOURCE_MAX_COUNT = 50

/**
 * The cancelled bookings an invoice declares as its origin.
 *
 * Capped rather than sent whole: Field rejects the request past its limit, and
 * losing the upstream origin of the fifty-first booking is a far smaller harm
 * than losing the invoice for all of them. CourseBoard's own row keeps the
 * invoice id either way, so nothing becomes unfindable.
 */
export function cancellationFeeSources(reservationIds: string[]): InvoiceSource[] {
  const seen = new Set<string>()
  const sources: InvoiceSource[] = []
  for (const raw of reservationIds) {
    const sourceId = raw.trim()
    if (!sourceId || seen.has(sourceId)) continue
    seen.add(sourceId)
    if (sources.length >= INVOICE_SOURCE_MAX_COUNT) break
    sources.push({ sourceType: 'reservation', sourceId, reason: CANCELLATION_FEE_REASON })
  }
  return sources
}

/**
 * Whether an invoice is a cancellation fee.
 *
 * Three readings, and all three are needed. The declared source is the real
 * answer and the only one an operator cannot break. The `notes` marker is what
 * every invoice raised before PLT-4158 has, and dropping that reading would
 * empty the list of its whole history. The line-item prefix is older still.
 */
export function isCancellationFeeInvoice(invoice: {
  sources?: InvoiceSource[] | null
  notes?: string | null
  lineItems?: { description: string }[]
}): boolean {
  return (invoice.sources ?? []).some(source => source.reason === CANCELLATION_FEE_REASON)
    || Boolean(invoice.notes?.includes(CANCELLATION_FEE_MARKER))
    || (invoice.lineItems ?? []).some(item =>
      item.description.startsWith(LEGACY_FEE_DESCRIPTION_PREFIX))
}

/**
 * Which bookings already carry a cancellation-fee invoice, according to Field.
 *
 * The guard against billing somebody twice. CourseBoard's own rows answer this
 * for every batch it managed to record, but the case worth catching is the one
 * it could not: the invoice went out and the write back failed, so the row is
 * still `unsettled` and the next extraction offers it again. Until PLT-4158
 * there was no way to ask upstream at all.
 *
 * Best effort by nature — it reads a page of invoices, not all of them — so it
 * narrows a batch and never widens one.
 */
export function invoicedReservationIds(
  invoices: { sources?: InvoiceSource[] | null }[],
): Set<string> {
  const billed = new Set<string>()
  for (const invoice of invoices) {
    for (const source of invoice.sources ?? []) {
      if (source.sourceType === 'reservation' && source.reason === CANCELLATION_FEE_REASON) {
        billed.add(source.sourceId)
      }
    }
  }
  return billed
}

/** Where a cancellation-fee invoice is asked for by what it is for. */
export const cancellationFeeInvoicesPath =
  `/v1/invoices?reason=${encodeURIComponent(CANCELLATION_FEE_REASON)}`

/**
 * How the oldest cancellation fees named themselves, before the marker.
 *
 * Kept only so the list still finds them.
 */
export const LEGACY_FEE_DESCRIPTION_PREFIX = 'キャンセル料'

export function invoiceBillTo(input: {
  kind: string
  customerId?: string
  clientId?: string
  affiliationId?: string
}): InvoiceBillTo | undefined {
  if (input.kind === 'customer') {
    const customerId = input.customerId?.trim()
    return customerId ? { kind: 'customer', customerId } : undefined
  }
  if (input.kind === 'client') {
    const clientId = input.clientId?.trim()
    const affiliationId = input.affiliationId?.trim()
    return clientId && affiliationId
      ? { kind: 'client', clientId, affiliationId }
      : undefined
  }
  return undefined
}

export function cancellationFeeInvoiceRequestBody(input: CancellationFeeInvoiceRequestInput) {
  return {
    billTo: input.billTo,
    // Omitted rather than sent empty: an invoice with no declared origin is
    // the shape Field already had, and `sources: []` would claim we looked.
    ...(input.sources?.length ? { sources: input.sources } : {}),
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    clientPhone: input.clientPhone,
    dueDate: input.dueDate,
    currency: 'JPY',
    taxAmount: input.taxAmount,
    notes: input.notes,
    lineItems: [{
      description: input.description,
      quantity: 1,
      unitPrice: input.amount,
    }],
    createPaymentLink: true,
    paymentLinkProvider: 'stripe',
    sendEmail: input.sendEmail,
    sendSms: input.sendSms,
    smsMessage: input.smsMessage,
  }
}

/**
 * A phone number Field will accept, or an empty string.
 *
 * Returning empty rather than throwing is deliberate: the caller decides
 * whether a number it cannot read is a validation error (SMS was asked for) or
 * simply nothing to send to.
 */
export function normalizePhone(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) {
    const normalized = `+${trimmed.slice(1).replace(/\D/g, '')}`
    return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : ''
  }
  const digits = trimmed.replace(/\D/g, '')
  if (/^0\d{9,10}$/.test(digits)) return `+81${digits.slice(1)}`
  return ''
}
