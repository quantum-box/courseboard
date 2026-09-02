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

export type CancellationFeeInvoiceRequestInput = {
  billTo: InvoiceBillTo
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
