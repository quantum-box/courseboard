import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancellationFeeInvoiceRequestBody,
  deliveryFailures,
  EDITABLE_INVOICE_STATUSES,
  filterDisplayedInvoices,
  fulfillmentIssue,
  invoiceDisplayStatus,
  invoiceBillTo,
  isInvoiceUpdateAllowed,
  normalizePhone,
  summarize,
} from './CancellationFeesPage'
import {
  CANCELLATION_FEE_MARKER,
  cancellationFeeSources,
  invoicedReservationIds,
  isCancellationFeeInvoice,
  INVOICE_SOURCE_MAX_COUNT,
} from './models'

afterEach(() => {
  vi.useRealTimers()
})

describe('cancellation fee display status', () => {
  it('derives overdue from the tenant business date, including timezone boundaries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T15:30:00.000Z'))
    const invoice = { status: 'Sent' as const, dueDate: '2026-08-31' }

    // The same instant is September 1 in Tokyo but still August 31 in New
    // York, so only the Tokyo invoice is overdue.
    expect(invoiceDisplayStatus(invoice, 'Asia/Tokyo')).toBe('Overdue')
    expect(invoiceDisplayStatus(invoice, 'America/New_York')).toBe('Sent')
  })

  it('does not mark the due date itself overdue', () => {
    expect(invoiceDisplayStatus(
      { status: 'SendFailed', dueDate: '2026-09-01' },
      'Asia/Tokyo',
      '2026-09-01',
    )).toBe('SendFailed')
  })

  it('preserves paid and stored overdue states regardless of due date', () => {
    expect(invoiceDisplayStatus(
      { status: 'Paid', dueDate: '2026-01-01' },
      'Asia/Tokyo',
      '2026-09-01',
    )).toBe('Paid')
    expect(invoiceDisplayStatus(
      { status: 'Overdue', dueDate: '2026-12-31' },
      'Asia/Tokyo',
      '2026-09-01',
    )).toBe('Overdue')
  })

  it('falls back to the stored state for malformed due dates', () => {
    expect(invoiceDisplayStatus(
      { status: 'Sent', dueDate: '2026-02-31' },
      'Asia/Tokyo',
      '2026-09-01',
    )).toBe('Sent')
    expect(invoiceDisplayStatus(
      { status: 'Draft', dueDate: 'not-a-date' },
      'Asia/Tokyo',
      '2026-09-01',
    )).toBe('Draft')
  })

  it('uses the same derived state for filtering and summary totals', () => {
    const invoices = [
      { id: 'sent-overdue', status: 'Sent' as const, dueDate: '2026-08-31', totalAmount: 1_000 },
      { id: 'sent-current', status: 'Sent' as const, dueDate: '2026-09-01', totalAmount: 2_000 },
      { id: 'paid', status: 'Paid' as const, dueDate: '2026-08-01', totalAmount: 3_000 },
    ]
    const displayed = invoices.map(invoice => ({
      ...invoice,
      status: invoiceDisplayStatus(invoice, 'Asia/Tokyo', '2026-09-01'),
    }))

    expect(filterDisplayedInvoices(displayed, 'Overdue').map(invoice => invoice.id)).toEqual(['sent-overdue'])
    expect(summarize(invoices, 'Asia/Tokyo', '2026-09-01')).toEqual({
      count: 3,
      unpaid: 3_000,
      overdue: 1,
      paid: 3_000,
    })
  })
})

describe('cancellation fee status operations', () => {
  it('does not expose Paid as an ordinary editable state', () => {
    expect(EDITABLE_INVOICE_STATUSES).toEqual(['Draft', 'Sent', 'SendFailed', 'Overdue'])
    expect(EDITABLE_INVOICE_STATUSES).not.toContain('Paid')
  })

  it('locks all invoice updates after payment', () => {
    expect(isInvoiceUpdateAllowed({ status: 'Paid' })).toBe(false)
    expect(isInvoiceUpdateAllowed({ status: 'Sent' })).toBe(true)
  })
})

describe('cancellation fee invoice request', () => {
  it('puts a typed client billTo in each POST body without a legacy clientId', () => {
    const billTo = invoiceBillTo({
      kind: 'client',
      clientId: ' cl_company_x ',
      affiliationId: ' ccaf_person_a_company_x ',
    })
    expect(billTo).toEqual({
      kind: 'client',
      clientId: 'cl_company_x',
      affiliationId: 'ccaf_person_a_company_x',
    })

    const base = {
      billTo: billTo!,
      clientName: 'Company X',
      dueDate: '2026-08-31',
      taxAmount: 0,
      amount: 5_000,
      sendEmail: false,
      sendSms: false,
    }
    const bodies = [
      cancellationFeeInvoiceRequestBody({
        ...base,
        notes: 'Cancellation RSV-1001',
        description: 'Cancellation fee (RSV-1001)',
      }),
      cancellationFeeInvoiceRequestBody({
        ...base,
        notes: 'Cancellation RSV-1002',
        description: 'Cancellation fee (RSV-1002)',
      }),
    ].map(body => JSON.parse(JSON.stringify(body)) as Record<string, unknown>)

    for (const body of bodies) {
      expect(body.billTo).toEqual({
        kind: 'client',
        clientId: 'cl_company_x',
        affiliationId: 'ccaf_person_a_company_x',
      })
      expect(body).not.toHaveProperty('clientId')
      expect(JSON.stringify(body)).not.toContain('courseboard:')
    }
    expect(bodies[0]?.billTo).toEqual(bodies[1]?.billTo)
  })

  it('builds a typed customer recipient and rejects incomplete identities', () => {
    expect(invoiceBillTo({ kind: 'customer', customerId: ' cus_person_a ' })).toEqual({
      kind: 'customer',
      customerId: 'cus_person_a',
    })
    expect(invoiceBillTo({ kind: 'customer', customerId: ' ' })).toBeUndefined()
    expect(invoiceBillTo({ kind: 'client', clientId: 'cl_company_x' })).toBeUndefined()
  })
})

describe('cancellation fee fulfillment', () => {
  const sentInvoice = {
    status: 'Sent' as const,
    paymentLinkStatus: 'Ready' as const,
    paymentLinkUrl: 'https://buy.stripe.com/example',
    emailDeliveryStatus: 'Sent' as const,
    smsDeliveryStatus: 'Sent' as const,
  }

  it('accepts only a ready payment link and selected sent deliveries', () => {
    expect(fulfillmentIssue(sentInvoice, { sendEmail: true, sendSms: true })).toBeUndefined()
  })

  it('rejects a successful HTTP response without a ready URL', () => {
    expect(fulfillmentIssue(
      { ...sentInvoice, paymentLinkStatus: 'Pending', paymentLinkUrl: null },
      { sendEmail: true, sendSms: false },
    )).toContain('支払いリンク')
  })

  it('rejects incomplete selected delivery', () => {
    expect(fulfillmentIssue(
      { ...sentInvoice, smsDeliveryStatus: 'Failed' },
      { sendEmail: false, sendSms: true },
    )).toContain('SMS')
  })

  it('names the fix when Field says why the send failed', () => {
    const issue = fulfillmentIssue(
      { ...sentInvoice, smsDeliveryStatus: 'Failed', smsDeliveryFailureCode: 'PermissionDenied' },
      { sendEmail: false, sendSms: true },
    )
    expect(issue).toContain('SMS')
    expect(issue).toContain('権限')
  })

  it('reads a snake_case failure code as the same cause', () => {
    expect(deliveryFailures({
      emailDeliveryStatus: null,
      smsDeliveryStatus: 'Failed',
      smsDeliveryFailureCode: 'billing_not_ready',
    })).toEqual([
      { channel: 'sms', label: 'SMS', reason: expect.stringContaining('残高') },
    ])
  })

  it('falls back to all three causes while Field sends no code', () => {
    const [failure] = deliveryFailures({
      emailDeliveryStatus: null,
      smsDeliveryStatus: 'Failed',
    })
    expect(failure?.reason).toContain('送り先')
  })

  it('reports nothing for a channel the invoice never asked for', () => {
    expect(deliveryFailures({ emailDeliveryStatus: null, smsDeliveryStatus: 'Sent' })).toEqual([])
  })
})

describe('normalizePhone', () => {
  it('normalizes Japanese mobile numbers and E.164 values', () => {
    expect(normalizePhone('090-1234-5678')).toBe('+819012345678')
    expect(normalizePhone('+81 90 1234 5678')).toBe('+819012345678')
  })

  it('rejects invalid destinations', () => {
    expect(normalizePhone('123')).toBe('')
    expect(normalizePhone('+0123456789')).toBe('')
  })
})

describe('what an invoice was raised from', () => {
  it('declares every cancelled booking on the invoice', () => {
    const sources = cancellationFeeSources(['res_1', 'res_2'])
    expect(sources).toEqual([
      { sourceType: 'reservation', sourceId: 'res_1', reason: 'cancellation_fee' },
      { sourceType: 'reservation', sourceId: 'res_2', reason: 'cancellation_fee' },
    ])
  })

  it('never sends more origins than Field accepts', () => {
    // Past the cap Field rejects the request, and losing one booking's
    // upstream origin is a far smaller harm than losing the whole invoice.
    const many = Array.from({ length: INVOICE_SOURCE_MAX_COUNT + 5 }, (_, i) => `res_${i}`)
    expect(cancellationFeeSources(many)).toHaveLength(INVOICE_SOURCE_MAX_COUNT)
  })

  it('drops blanks and repeats', () => {
    expect(cancellationFeeSources(['res_1', ' res_1 ', '', '  '])).toHaveLength(1)
  })

  it('omits the origins entirely rather than claiming an empty search', () => {
    const body = cancellationFeeInvoiceRequestBody({
      billTo: { kind: 'customer', customerId: 'cus_1' },
      sources: [],
      clientName: '本田 康彦',
      dueDate: '2026-06-17',
      taxAmount: 0,
      notes: '',
      description: 'キャンセル料',
      amount: 5_000,
      sendEmail: false,
      sendSms: false,
    })
    expect('sources' in body).toBe(false)
  })
})

describe('finding cancellation fees among ordinary invoices', () => {
  it('reads the declared source', () => {
    expect(isCancellationFeeInvoice({
      sources: [{ sourceType: 'reservation', sourceId: 'res_1', reason: 'cancellation_fee' }],
    })).toBe(true)
  })

  it('still finds the ones raised before invoices could say what they were for', () => {
    // Dropping this reading would empty the list of its whole history.
    expect(isCancellationFeeInvoice({ notes: `${CANCELLATION_FEE_MARKER}\nご請求です` })).toBe(true)
    expect(isCancellationFeeInvoice({
      lineItems: [{ description: 'キャンセル料（4名）' }],
    })).toBe(true)
  })

  it('leaves ordinary invoices alone', () => {
    expect(isCancellationFeeInvoice({
      sources: [{ sourceType: 'order', sourceId: 'ord_1', reason: 'late_delivery' }],
      notes: 'ご請求です',
      lineItems: [{ description: 'プレー料金' }],
    })).toBe(false)
  })

  it('collects the bookings already billed, ignoring other kinds of origin', () => {
    const billed = invoicedReservationIds([
      { sources: [
        { sourceType: 'reservation', sourceId: 'res_1', reason: 'cancellation_fee' },
        { sourceType: 'reservation', sourceId: 'res_2', reason: 'no_show_fee' },
        { sourceType: 'order', sourceId: 'res_1', reason: 'cancellation_fee' },
      ] },
      { sources: null },
      {},
    ])
    expect([...billed]).toEqual(['res_1'])
  })
})
