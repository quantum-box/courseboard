import type { EffectiveCapabilities } from './EffectiveCapabilitiesProvider'

/** The action names are the server's policy identifiers, not UI roles. */
export const FIELD_ACTIONS = {
  listTeeSheet: 'field_extension_golf:ListTeeSheet',
  manageReservations: 'field_extension_golf:ManageReservations',
  listSlotOverrides: 'field_extension_golf:ListSlotOverrides',
  manageSlotOverrides: 'field_extension_golf:ManageSlotOverrides',
  listCourses: 'field_extension_golf:ListCourses',
  manageCourses: 'field_extension_golf:ManageCourses',
  listProducts: 'field_extension_golf:ListProducts',
  manageProducts: 'field_extension_golf:ManageProducts',
  listReservationPolicy: 'field_extension_golf:ListReservationPolicy',
  manageReservationPolicy: 'field_extension_golf:ManageReservationPolicy',
  listCustomers: 'field_extension_golf:ListCustomers',
  manageCustomers: 'field_extension_golf:ManageCustomers',
  listMembership: 'field_extension_golf:ListMembership',
  manageMembershipPlans: 'field_extension_golf:ManageMembershipPlans',
  assignMembership: 'field_extension_golf:AssignMembership',
  listCaddies: 'field_extension_golf:ListCaddies',
  manageCaddies: 'field_extension_golf:ManageCaddies',
  listCaddieAssignments: 'field_extension_golf:ListCaddieAssignments',
  manageCaddieAssignments: 'field_extension_golf:ManageCaddieAssignments',
  listCaddieAvailability: 'field_extension_golf:ListCaddieAvailability',
  manageCaddieAvailability: 'field_extension_golf:ManageCaddieAvailability',
  listShifts: 'field_extension_golf:ListShifts',
  manageShifts: 'field_extension_golf:ManageShifts',
  listCaddieInsights: 'field_extension_golf:ListCaddieInsights',
  listCaddieRankFees: 'field_extension_golf:ListCaddieRankFees',
  manageCaddieRankFees: 'field_extension_golf:ManageCaddieRankFees',
  listPayroll: 'field_extension_golf:ListPayroll',
  listSettlement: 'field_extension_golf:ListSettlement',
  listBudgets: 'field_extension_golf:ListBudgets',
  manageBudgets: 'field_extension_golf:ManageBudgets',
  calculateFees: 'field_extension_golf:CalculateFees',
  listReservationReports: 'field_extension_golf:ListReservationReports',
  importReservationReports: 'field_extension_golf:ImportReservationReports',
  listExtensionStatus: 'field_extension_golf:ListExtensionStatus',
  // Field-owned routes are intentionally separate from CourseBoard's
  // field_extension_golf actions. A CourseBoard screen may call both stores,
  // so its entry decision has to account for both policy boundaries.
  fieldListReservations: 'field:ListReservations',
  fieldListCustomers: 'field:ListCustomers',
  fieldListMembership: 'field:ListMembership',
  listHrm: 'field:ListHrm',
  manageHrm: 'field:ManageHrm',
  manageUsers: 'field:ManageUsers',
  listBridgeDefinitions: 'field:ListBridgeDefinitions',
  previewBridgeRun: 'field:PreviewBridgeRun',
  listBridgeExportDefinitions: 'field:ListBridgeExportDefinitions',
} as const

export type FieldAction = typeof FIELD_ACTIONS[keyof typeof FIELD_ACTIONS]

type RouteActionRequirement = {
  /** Every action is needed to mount a page and its eager loaders. */
  allOf?: readonly string[]
  /** At least one action is enough for a hub whose links are filtered below. */
  anyOf?: readonly string[]
}

const requirement = (...actions: readonly string[]): RouteActionRequirement => ({ anyOf: actions })
const allRequirements = (...actions: readonly string[]): RouteActionRequirement => ({ allOf: actions })

const GOLF_HOME_ACTIONS = [
  FIELD_ACTIONS.listTeeSheet,
  FIELD_ACTIONS.listCourses,
  FIELD_ACTIONS.listProducts,
  FIELD_ACTIONS.listReservationPolicy,
  FIELD_ACTIONS.listCustomers,
  FIELD_ACTIONS.listMembership,
  FIELD_ACTIONS.listCaddies,
  FIELD_ACTIONS.listCaddieAssignments,
  FIELD_ACTIONS.listCaddieAvailability,
  FIELD_ACTIONS.listShifts,
  FIELD_ACTIONS.listCaddieInsights,
  FIELD_ACTIONS.listCaddieRankFees,
  FIELD_ACTIONS.listPayroll,
  FIELD_ACTIONS.listSettlement,
  FIELD_ACTIONS.listBudgets,
  FIELD_ACTIONS.calculateFees,
  FIELD_ACTIONS.listReservationReports,
  FIELD_ACTIONS.listExtensionStatus,
] as const

const SETTINGS_ACTIONS = [
  FIELD_ACTIONS.listCourses,
  FIELD_ACTIONS.listReservationPolicy,
  FIELD_ACTIONS.listExtensionStatus,
  FIELD_ACTIONS.listMembership,
  FIELD_ACTIONS.listCustomers,
  FIELD_ACTIONS.listCaddieAssignments,
  FIELD_ACTIONS.manageUsers,
  FIELD_ACTIONS.listBridgeExportDefinitions,
] as const

const DATA_EXPORT_SOURCE_ACTIONS = [
  FIELD_ACTIONS.listTeeSheet,
  FIELD_ACTIONS.listCourses,
  FIELD_ACTIONS.listProducts,
  FIELD_ACTIONS.listCustomers,
  FIELD_ACTIONS.listMembership,
  FIELD_ACTIONS.listCaddies,
  FIELD_ACTIONS.listCaddieAssignments,
  FIELD_ACTIONS.listCaddieAvailability,
  FIELD_ACTIONS.listShifts,
  FIELD_ACTIONS.listCaddieRankFees,
  FIELD_ACTIONS.listPayroll,
  FIELD_ACTIONS.listSettlement,
  FIELD_ACTIONS.calculateFees,
  FIELD_ACTIONS.listReservationReports,
] as const

const NON_FEE_STARTUP_ROUTES = [
  'golf',
  'golf/ledger',
  'golf/timeline',
  'golf/customers',
  'golf/products',
  'golf/courses',
  'golf/caddies',
  'golf/caddies/dispatch',
  'golf/caddies/shifts',
  'golf/caddies/payroll',
  'staff',
  'golf/budgets',
  'golf/settlement',
  'golf/simulator',
  'golf/data-imports',
  'golf/reservation-report-import',
  'course-map',
  'settings',
  'settings/advanced',
  'settings/data-exports',
  'settings/members',
  'settings/membership-plans',
  'settings/membership-discounts',
  'settings/membership-play-windows',
  'settings/customer-grades',
  'settings/caddie-duties',
  'settings/reception-fields',
] as const

/**
 * Return the policy action(s) needed to enter a route. Nested routes inherit
 * the same action as their collection route. The settings hub itself only
 * contains links, so it is admitted when one of its known links is usable and
 * filters the links individually.
 */
export function routeActionRequirement(route: string): RouteActionRequirement | null {
  if (route === 'cancellation-fees/new') return null
  if (route === 'cancellation-fees' || route.startsWith('cancellation-fees/')) return null
  if (route === 'settings') return requirement(...SETTINGS_ACTIONS)
  if (route === 'golf') return requirement(...GOLF_HOME_ACTIONS)
  if (route === 'golf/ledger') {
    return allRequirements(
      FIELD_ACTIONS.listTeeSheet,
      FIELD_ACTIONS.listSlotOverrides,
      FIELD_ACTIONS.listCourses,
      FIELD_ACTIONS.listProducts,
      FIELD_ACTIONS.listCaddieInsights,
      FIELD_ACTIONS.listCaddieAssignments,
      FIELD_ACTIONS.listShifts,
    )
  }
  if (route === 'golf/timeline') {
    return allRequirements(
      FIELD_ACTIONS.listTeeSheet,
      FIELD_ACTIONS.listCaddieAssignments,
      FIELD_ACTIONS.listCaddies,
      FIELD_ACTIONS.listCaddieAvailability,
      FIELD_ACTIONS.listCourses,
    )
  }
  if (route === 'course-map') {
    return requirement(FIELD_ACTIONS.listCourses)
  }
  if (route === 'golf/courses' || route.startsWith('golf/courses/')) {
    return requirement(FIELD_ACTIONS.listCourses)
  }
  if (route === 'golf/products' || route.startsWith('golf/products/')
    || route === 'golf/reservation-products' || route.startsWith('golf/reservation-products/')) {
    return allRequirements(FIELD_ACTIONS.listProducts, FIELD_ACTIONS.listCourses)
  }
  if (route === 'golf/customers') {
    return requirement(FIELD_ACTIONS.listCustomers)
  }
  // The generic cancellation list only loads the customer-owned cancellation
  // query. Its optional billing sheet is opened later and is separately
  // authorized by the existing accounting flow; do not make the dedicated
  // cancellation-fee action a prerequisite for this legacy screen.
  if (route === 'golf/customers/reception') {
    return allRequirements(FIELD_ACTIONS.listCustomers, FIELD_ACTIONS.manageCustomers)
  }
  if (route === 'golf/customers/call-list'
    || route === 'golf/customers/cancellations') {
    return requirement(FIELD_ACTIONS.listCustomers)
  }
  if (route.startsWith('golf/customers/')) {
    return allRequirements(
      FIELD_ACTIONS.listCustomers,
      FIELD_ACTIONS.listMembership,
      FIELD_ACTIONS.listCourses,
    )
  }
  if (route === 'golf/caddies/shifts') {
    return allRequirements(
      FIELD_ACTIONS.listShifts,
      FIELD_ACTIONS.listCaddies,
      FIELD_ACTIONS.listCaddieAssignments,
      FIELD_ACTIONS.listCaddieAvailability,
      FIELD_ACTIONS.listCourses,
    )
  }
  if (route === 'golf/caddies/dispatch') {
    return allRequirements(
      FIELD_ACTIONS.listCaddies,
      FIELD_ACTIONS.listCaddieAssignments,
      FIELD_ACTIONS.listCaddieInsights,
      FIELD_ACTIONS.listTeeSheet,
      FIELD_ACTIONS.listCaddieAvailability,
    )
  }
  if (route === 'golf/caddies/attendance') {
    return allRequirements(
      FIELD_ACTIONS.listCaddies,
      FIELD_ACTIONS.listCaddieInsights,
    )
  }
  if (route === 'golf/caddies/payroll') {
    return allRequirements(FIELD_ACTIONS.listPayroll, FIELD_ACTIONS.listCaddieRankFees)
  }
  if (route === 'golf/caddies' || route.startsWith('golf/caddies/')) {
    return allRequirements(
      FIELD_ACTIONS.listCaddies,
      FIELD_ACTIONS.listCaddieAssignments,
      FIELD_ACTIONS.listCaddieInsights,
      FIELD_ACTIONS.listCourses,
    )
  }
  if (route === 'staff' || route.startsWith('staff/')) {
    return allRequirements(
      FIELD_ACTIONS.listHrm,
      FIELD_ACTIONS.listCaddies,
      FIELD_ACTIONS.listCaddieInsights,
    )
  }
  if (route === 'golf/data-imports' || route.startsWith('golf/data-imports/')) {
    return requirement(FIELD_ACTIONS.listBridgeDefinitions)
  }
  if (route === 'golf/reservation-report-import') {
    return allRequirements(
      FIELD_ACTIONS.listReservationReports,
      FIELD_ACTIONS.listCourses,
    )
  }
  if (route === 'golf/budgets') {
    return allRequirements(
      FIELD_ACTIONS.listCourses,
      FIELD_ACTIONS.listBudgets,
    )
  }
  if (route === 'golf/policy') {
    return allRequirements(FIELD_ACTIONS.listCourses, FIELD_ACTIONS.listReservationPolicy)
  }
  if (route === 'golf/settlement') {
    return allRequirements(
      FIELD_ACTIONS.listSettlement,
      FIELD_ACTIONS.listCourses,
    )
  }
  if (route === 'golf/simulator') {
    return allRequirements(
      FIELD_ACTIONS.calculateFees,
      FIELD_ACTIONS.listMembership,
      FIELD_ACTIONS.fieldListMembership,
    )
  }
  if (route === 'settings/advanced') {
    return allRequirements(
      FIELD_ACTIONS.listExtensionStatus,
      FIELD_ACTIONS.listTeeSheet,
      FIELD_ACTIONS.listReservationPolicy,
    )
  }
  if (route === 'settings/data-exports') {
    return {
      allOf: [FIELD_ACTIONS.listBridgeExportDefinitions],
      anyOf: DATA_EXPORT_SOURCE_ACTIONS,
    }
  }
  if (route === 'settings/members') return requirement(FIELD_ACTIONS.manageUsers)
  if (route === 'settings/membership-plans'
    || route === 'settings/membership-discounts'
    || route === 'settings/membership-play-windows') {
    return allRequirements(FIELD_ACTIONS.listMembership, FIELD_ACTIONS.fieldListMembership)
  }
  if (route === 'settings/customer-grades') return requirement(FIELD_ACTIONS.listCustomers)
  if (route === 'settings/reception-fields') {
    return allRequirements(FIELD_ACTIONS.listCustomers, FIELD_ACTIONS.manageCustomers)
  }
  if (route === 'settings/caddie-duties') return requirement(FIELD_ACTIONS.listCaddieAssignments)
  return null
}

/** `undefined` means the route is not a protected operator route. */
export function routeCapabilityDecision(
  route: string,
  capabilities: EffectiveCapabilities,
): boolean | null | undefined {
  if (route === 'cancellation-fees/new') return capabilities.cancellationFees.manage
  if (route === 'cancellation-fees' || route.startsWith('cancellation-fees/')) {
    return capabilities.cancellationFees.list
  }
  const routeRequirement = routeActionRequirement(route)
  if (!routeRequirement) return undefined
  let allDecision: boolean | null = true
  if (routeRequirement.allOf) {
    for (const action of routeRequirement.allOf) {
      const decision = capabilities.actions[action]
      if (decision === false) allDecision = false
      else if (decision === null || decision === undefined) {
        if (allDecision !== false) allDecision = null
      }
    }
  }
  let anyDecision: boolean | null = routeRequirement.anyOf ? false : true
  if (routeRequirement.anyOf) {
    for (const action of routeRequirement.anyOf) {
      const decision = capabilities.actions[action]
      if (decision === true) anyDecision = true
      else if ((decision === null || decision === undefined) && anyDecision !== true) anyDecision = null
    }
  }
  // A known denial is definitive even when another required branch is still
  // unknown. This prevents a mixed allOf/anyOf route (for example exports)
  // from surfacing as a retryable snapshot when its source is explicitly
  // forbidden.
  if (allDecision === false || anyDecision === false) return false
  if (allDecision === null || anyDecision === null) return null
  return true
}

/** Match a route against the server's authoritative action map. */
export function capabilityRouteAllowed(route: string, capabilities: EffectiveCapabilities) {
  return routeCapabilityDecision(route, capabilities) === true
}

/** Check a button or handler against one exact server action. */
export function capabilityActionAllowed(action: string, capabilities: EffectiveCapabilities) {
  return capabilities.actions[action] === true
}

/**
 * Compute the startup-only non-fee aggregate from complete route decisions.
 * The aggregate is only a startup hint. A true aggregate preserves access to
 * other products, while a false aggregate is useful only when every known
 * non-fee entry route is explicitly denied. It never authorizes a route.
 */
export function nonFeeBusinessAccessDecision(capabilities: EffectiveCapabilities): boolean | null {
  const decisions = NON_FEE_STARTUP_ROUTES.map(route => routeCapabilityDecision(route, capabilities))
  const courseDecision = decisions.some(decision => decision === true)
    ? true
    : decisions.some(decision => decision === null || decision === undefined)
      ? null
      : false
  if (courseDecision === true || capabilities.navigation.otherBusinessAccess === true) return true
  if (capabilities.navigation.otherBusinessAccess !== false) return null
  return courseDecision
}

export function routeCapabilitySnapshotKnown(route: string, capabilities: EffectiveCapabilities) {
  return routeCapabilityDecision(route, capabilities) !== null
}
