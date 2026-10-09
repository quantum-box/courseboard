import { describe, expect, it } from 'vitest'
import {
  capabilitySnapshotReadyForRoute,
  startupRouteForCapabilities,
  type EffectiveCapabilities,
} from './EffectiveCapabilitiesProvider'
import { FIELD_ACTIONS } from './capabilityRoutes'

const allActionsDenied = Object.fromEntries(
  Object.values(FIELD_ACTIONS).map(action => [action, false]),
)

const cancellationOnly: EffectiveCapabilities = {
  actions: allActionsDenied,
  navigation: { otherBusinessAccess: false },
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

  it('opens the dedicated create flow for a manage-only operator', () => {
    const manageOnly = {
      ...cancellationOnly,
      cancellationFees: { list: false, manage: true },
    }
    expect(startupRouteForCapabilities('golf', manageOnly)).toBe('cancellation-fees/new')
    expect(startupRouteForCapabilities('staff', manageOnly)).toBe('cancellation-fees/new')
  })

  it('preserves an explicit cancellation-fee deep link', () => {
    expect(startupRouteForCapabilities('cancellation-fees', cancellationOnly)).toBeNull()
    expect(startupRouteForCapabilities('cancellation-fees/inv_1', cancellationOnly)).toBeNull()
  })

  it('leaves mixed-product and unentitled operators to the downstream guard', () => {
    const mixed = {
      ...cancellationOnly,
      navigation: { otherBusinessAccess: true },
      agentDocuments: {
        ...cancellationOnly.agentDocuments,
        invoices: { list: true, send: false },
      },
    }
    expect(startupRouteForCapabilities('golf', mixed)).toBeNull()
    expect(startupRouteForCapabilities('golf', {
      ...cancellationOnly,
      navigation: { otherBusinessAccess: true },
    })).toBeNull()
    expect(startupRouteForCapabilities('golf', {
      ...cancellationOnly,
      navigation: { otherBusinessAccess: null },
    })).toBeNull()
    expect(startupRouteForCapabilities('golf', {
      ...cancellationOnly,
      cancellationFees: { list: false, manage: false },
    })).toBeNull()
  })
})

describe('capabilitySnapshotReadyForRoute', () => {
  it('blocks non-fee routes when Field has not completed the navigation aggregate', () => {
    const incomplete = {
      ...cancellationOnly,
      actions: {},
      navigation: { otherBusinessAccess: null },
    }
    expect(capabilitySnapshotReadyForRoute('golf', incomplete)).toBe(false)
    expect(capabilitySnapshotReadyForRoute('staff', incomplete)).toBe(false)
  })

  it('allows a fee deep link to use its known fee actions without that aggregate', () => {
    const incomplete = {
      ...cancellationOnly,
      navigation: { otherBusinessAccess: null },
    }
    expect(capabilitySnapshotReadyForRoute('cancellation-fees', incomplete)).toBe(true)
    expect(capabilitySnapshotReadyForRoute('cancellation-fees/inv_1', incomplete)).toBe(true)
  })
})
