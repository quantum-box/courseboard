import { describe, expect, it } from 'vitest'
import { capabilityRouteAllowed } from './capabilityRoutes'
import type { EffectiveCapabilities } from './EffectiveCapabilitiesProvider'

const capabilities: EffectiveCapabilities = {
  navigation: { otherBusinessAccess: false },
  cancellationFees: { list: true, manage: false },
  agentDocuments: {
    invoices: { list: false, send: false },
    quotations: { list: false, send: false },
  },
}

describe('capability route actions', () => {
  it('permits fee reads without admitting create or other business routes', () => {
    expect(capabilityRouteAllowed('cancellation-fees', capabilities)).toBe(true)
    expect(capabilityRouteAllowed('cancellation-fees/inv_1', capabilities)).toBe(true)
    for (const route of ['cancellation-fees/new', 'golf/ledger', 'staff', 'settings']) {
      expect(capabilityRouteAllowed(route, capabilities)).toBe(false)
    }
  })

  it('does not infer list permission from the independent manage action', () => {
    const manageOnly = { ...capabilities, cancellationFees: { list: false, manage: true } }
    expect(capabilityRouteAllowed('cancellation-fees/new', manageOnly)).toBe(true)
    expect(capabilityRouteAllowed('cancellation-fees', manageOnly)).toBe(false)
    expect(capabilityRouteAllowed('cancellation-fees/inv_1', manageOnly)).toBe(false)
  })

  it('keeps mixed-product navigation but denies absent fee actions', () => {
    const mixed = {
      ...capabilities,
      navigation: { otherBusinessAccess: true },
      cancellationFees: { list: false, manage: false },
    }
    expect(capabilityRouteAllowed('golf/ledger', mixed)).toBe(true)
    expect(capabilityRouteAllowed('cancellation-fees', mixed)).toBe(false)
    expect(capabilityRouteAllowed('cancellation-fees/new', mixed)).toBe(false)
  })

  it('does not authorize another business route from an incomplete snapshot', () => {
    expect(capabilityRouteAllowed('golf/ledger', {
      ...capabilities, navigation: { otherBusinessAccess: null },
    })).toBe(false)
  })
})
