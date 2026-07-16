import { describe, expect, it } from 'vitest'
import { safeExternalUrl } from './platform'

describe('safeExternalUrl', () => {
  it('accepts trusted HTTPS payment and Courseboard hosts', () => {
    expect(safeExternalUrl('https://checkout.stripe.com/c/pay/test')).toBe(
      'https://checkout.stripe.com/c/pay/test',
    )
    expect(safeExternalUrl('https://courseboard.txcloud.app/pay/test')).toBe(
      'https://courseboard.txcloud.app/pay/test',
    )
  })

  it('rejects lookalike hosts, credentials, and non-HTTPS URLs', () => {
    expect(() => safeExternalUrl('https://stripe.com.evil.example/pay')).toThrow()
    expect(() => safeExternalUrl('https://user:secret@stripe.com/pay')).toThrow()
    expect(() => safeExternalUrl('http://checkout.stripe.com/pay')).toThrow()
  })
})
