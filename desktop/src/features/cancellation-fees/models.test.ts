import { describe, expect, it } from 'vitest'
import {
  cancellationFeeInvoiceRequestBody,
  fulfillmentIssue,
  invoiceBillTo,
  normalizePhone,
} from './CancellationFeesPage'

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
