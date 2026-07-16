import { describe, expect, it } from 'vitest'
import { fulfillmentIssue, normalizePhone } from './CancellationFeesPage'

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
