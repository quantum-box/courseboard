import { describe, expect, it } from 'vitest'
import { startupRouteForCapabilities, type EffectiveCapabilities } from './EffectiveCapabilitiesProvider'

const cancellationOnly: EffectiveCapabilities = {
  capabilityCoverage: 'complete',
  otherBusiness: {
    reservations: false,
    hrm: false,
    customers: false,
    memberships: false,
    usage: false,
  },
  agentDocuments: {
    invoices: { list: false, send: false },
    quotations: { list: false, send: false },
  },
  cancellationFees: { list: true, manage: true },
}

describe('startupRouteForCapabilities', () => {
  it('opens the cancellation-fee list for a cancellation-only operator', () => {
    expect(startupRouteForCapabilities('golf', cancellationOnly)).toBe('cancellation-fees')
    expect(startupRouteForCapabilities('staff', cancellationOnly)).toBe('cancellation-fees')
  })

  it('preserves an explicit cancellation-fee deep link', () => {
    expect(startupRouteForCapabilities('cancellation-fees', cancellationOnly)).toBeNull()
    expect(startupRouteForCapabilities('cancellation-fees/inv_1', cancellationOnly)).toBeNull()
  })

  it('leaves mixed-product and unentitled operators to the downstream guard', () => {
    const mixed = {
      ...cancellationOnly,
      agentDocuments: {
        ...cancellationOnly.agentDocuments,
        invoices: { list: true, send: false },
      },
    }
    expect(startupRouteForCapabilities('golf', mixed)).toBeNull()
    expect(startupRouteForCapabilities('golf', {
      ...cancellationOnly,
      otherBusiness: { ...cancellationOnly.otherBusiness, reservations: true },
    })).toBeNull()
    expect(startupRouteForCapabilities('golf', {
      ...cancellationOnly,
      capabilityCoverage: 'partial',
    })).toBeNull()
    expect(startupRouteForCapabilities('golf', {
      ...cancellationOnly,
      cancellationFees: { list: false, manage: false },
    })).toBeNull()
  })
})
