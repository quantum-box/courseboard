import { describe, expect, it } from 'vitest'
import {
  capabilityActionAllowed,
  capabilityRouteAllowed,
  FIELD_ACTIONS,
  routeCapabilityDecision,
} from './capabilityRoutes'
import type { EffectiveCapabilities } from './EffectiveCapabilitiesProvider'

const allActionsDenied = Object.fromEntries(
  Object.values(FIELD_ACTIONS).map(action => [action, false]),
)

const capabilities: EffectiveCapabilities = {
  actions: allActionsDenied,
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

  it('uses the exact action map instead of the navigation aggregate', () => {
    const mixed = {
      ...capabilities,
      actions: {
        ...allActionsDenied,
        [FIELD_ACTIONS.listTeeSheet]: true,
        [FIELD_ACTIONS.listSlotOverrides]: true,
        [FIELD_ACTIONS.listCourses]: true,
        [FIELD_ACTIONS.listReservationPolicy]: true,
        [FIELD_ACTIONS.listProducts]: true,
        [FIELD_ACTIONS.listCaddies]: true,
        [FIELD_ACTIONS.listCaddieInsights]: true,
        [FIELD_ACTIONS.listCaddieAssignments]: true,
        [FIELD_ACTIONS.listShifts]: true,
        [FIELD_ACTIONS.fieldListReservations]: true,
      },
      navigation: { otherBusinessAccess: false },
      cancellationFees: { list: false, manage: false },
    }
    expect(capabilityRouteAllowed('golf/ledger', mixed)).toBe(true)
    expect(capabilityRouteAllowed('staff', mixed)).toBe(false)
    expect(capabilityRouteAllowed('cancellation-fees', mixed)).toBe(false)
    expect(capabilityRouteAllowed('cancellation-fees/new', mixed)).toBe(false)
  })

  it('does not authorize a route from a true aggregate when its action is absent', () => {
    const aggregateOnly = {
      ...capabilities,
      actions: {},
      navigation: { otherBusinessAccess: true },
    }
    expect(capabilityRouteAllowed('golf/ledger', aggregateOnly)).toBe(false)
    expect(capabilityRouteAllowed('staff', aggregateOnly)).toBe(false)
    expect(capabilityRouteAllowed('settings', aggregateOnly)).toBe(false)
  })

  it('allows a known staff route while unrelated Golf actions remain unknown', () => {
    const staffOnly: EffectiveCapabilities = {
      ...capabilities,
      actions: {
        [FIELD_ACTIONS.listHrm]: true,
        [FIELD_ACTIONS.listCaddies]: true,
        [FIELD_ACTIONS.listCaddieInsights]: true,
      },
      navigation: { otherBusinessAccess: null },
    }
    expect(capabilityRouteAllowed('staff', staffOnly)).toBe(true)
    expect(capabilityRouteAllowed('staff/staff_1', staffOnly)).toBe(true)
    expect(capabilityRouteAllowed('golf/ledger', staffOnly)).toBe(false)
  })

  it('keeps aliases and nested collection routes on one action policy', () => {
    const products = {
      ...capabilities,
      actions: {
        ...allActionsDenied,
        [FIELD_ACTIONS.listProducts]: true,
        [FIELD_ACTIONS.listCourses]: true,
      },
    }
    for (const route of ['golf/products', 'golf/products/product_1', 'golf/reservation-products', 'golf/reservation-products/product_1']) {
      expect(capabilityRouteAllowed(route, products)).toBe(true)
    }
  })

  it('treats missing and malformed action decisions as unknown/denied', () => {
    const unknown = { ...capabilities, actions: {} }
    expect(capabilityRouteAllowed('golf/ledger', unknown)).toBe(false)
    expect(capabilityActionAllowed(FIELD_ACTIONS.listTeeSheet, unknown)).toBe(false)
    const malformed = { ...capabilities, actions: { [FIELD_ACTIONS.listTeeSheet]: null } }
    expect(capabilityRouteAllowed('golf/ledger', malformed)).toBe(false)
  })

  it('does not apply dedicated fee manage to the existing generic cancellation route', () => {
    const customers = {
      ...capabilities,
      actions: {
        [FIELD_ACTIONS.listCustomers]: true,
      },
      cancellationFees: { list: false, manage: false },
    }
    expect(capabilityRouteAllowed('golf/customers/cancellations', customers)).toBe(true)
    expect(capabilityRouteAllowed('golf/customers/customer_1', customers)).toBe(false)
    expect(capabilityRouteAllowed('cancellation-fees', customers)).toBe(false)
  })

  it('requires membership readers for the simulator initial loader', () => {
    const simulator = {
      ...capabilities,
      actions: { ...allActionsDenied, [FIELD_ACTIONS.calculateFees]: true },
    }
    expect(capabilityRouteAllowed('golf/simulator', simulator)).toBe(false)
    expect(capabilityRouteAllowed('golf/simulator', {
      ...simulator,
      actions: {
        ...simulator.actions,
        [FIELD_ACTIONS.listMembership]: true,
        [FIELD_ACTIONS.fieldListMembership]: true,
      },
    })).toBe(true)
  })

  it('does not mount the ledger while an eager loader action is unknown or denied', () => {
    const ledger = {
      ...capabilities,
      actions: {
        ...allActionsDenied,
        [FIELD_ACTIONS.listTeeSheet]: true,
        [FIELD_ACTIONS.listSlotOverrides]: true,
        [FIELD_ACTIONS.listCourses]: true,
        [FIELD_ACTIONS.listReservationPolicy]: true,
        [FIELD_ACTIONS.listProducts]: true,
        [FIELD_ACTIONS.listCaddies]: true,
        [FIELD_ACTIONS.listCaddieInsights]: true,
        [FIELD_ACTIONS.listCaddieAssignments]: true,
        [FIELD_ACTIONS.listShifts]: true,
        [FIELD_ACTIONS.fieldListReservations]: true,
      },
    }
    expect(capabilityRouteAllowed('golf/ledger', ledger)).toBe(true)
    expect(routeCapabilityDecision('golf/ledger', {
      ...ledger,
      actions: { ...ledger.actions, [FIELD_ACTIONS.listProducts]: null },
    })).toBeNull()
    expect(routeCapabilityDecision('golf/ledger', {
      ...ledger,
      actions: { ...ledger.actions, [FIELD_ACTIONS.listProducts]: false },
    })).toBe(false)
  })

  it('lets an explicit source denial dominate an unknown export bridge decision', () => {
    expect(routeCapabilityDecision('settings/data-exports', {
      ...capabilities,
      actions: {
        ...allActionsDenied,
        [FIELD_ACTIONS.listBridgeExportDefinitions]: null,
      },
    })).toBe(false)
  })

  it('requires the reception fields mutation boundary before mounting its eager loaders', () => {
    const customersOnly = {
      ...capabilities,
      actions: { [FIELD_ACTIONS.listCustomers]: true },
    }
    expect(capabilityRouteAllowed('golf/customers/reception', customersOnly)).toBe(false)
    expect(capabilityRouteAllowed('golf/customers/reception', {
      ...customersOnly,
      actions: {
        ...customersOnly.actions,
        [FIELD_ACTIONS.manageCustomers]: true,
      },
    })).toBe(true)
  })

  it('requires the export bridge and at least one canonical source reader', () => {
    const bridge = {
      ...capabilities,
      actions: {
        [FIELD_ACTIONS.listBridgeExportDefinitions]: true,
        [FIELD_ACTIONS.listCustomers]: true,
      },
    }
    expect(capabilityRouteAllowed('settings/data-exports', bridge)).toBe(true)
    expect(capabilityRouteAllowed('settings/data-exports', {
      ...bridge,
      actions: { [FIELD_ACTIONS.listBridgeExportDefinitions]: true },
    })).toBe(false)
  })
})
