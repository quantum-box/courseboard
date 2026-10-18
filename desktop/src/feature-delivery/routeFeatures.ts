/**
 * Which product feature each screen belongs to.
 *
 * The keys are the server's catalog (`src/feature_delivery/catalog.rs`,
 * rendered to `.tachyon/manifests/courseboard-product-features.yml`). The
 * manifest's `uiRefs` and this table are checked against each other in
 * `routeFeatures.test.ts`, so a screen cannot ship without a key.
 */

export const FEATURE_KEYS = Object.freeze([
  'courseboard.tee_sheet',
  'courseboard.tee_sheet.slot_overrides',
  'courseboard.tee_sheet.checkin',
  'courseboard.courses',
  'courseboard.products',
  'courseboard.reservation_policy',
  'courseboard.customers',
  'courseboard.customers.reception',
  'courseboard.customers.cancellations',
  'courseboard.membership',
  'courseboard.caddies',
  'courseboard.caddies.dispatch',
  'courseboard.caddies.availability',
  'courseboard.caddies.shifts',
  'courseboard.caddies.insights',
  'courseboard.caddies.rank_fees',
  'courseboard.caddies.payroll',
  'courseboard.staff',
  'courseboard.budgets',
  'courseboard.settlement',
  'courseboard.fee_simulator',
  'courseboard.reservation_report_import',
  'courseboard.data_imports',
  'courseboard.data_exports',
  'courseboard.cancellation_fee',
  'courseboard.course_map',
] as const)

export type FeatureKey = typeof FEATURE_KEYS[number]

/** Route pattern → feature. `:name` matches one segment. */
export const ROUTE_FEATURES: Readonly<Record<string, FeatureKey>> = Object.freeze({
  'golf/ledger': 'courseboard.tee_sheet',
  'golf/timeline': 'courseboard.tee_sheet',
  'golf/courses': 'courseboard.courses',
  'golf/courses/:courseId': 'courseboard.courses',
  'golf/products': 'courseboard.products',
  'golf/products/:serviceId': 'courseboard.products',
  'golf/policy': 'courseboard.reservation_policy',
  'settings/advanced': 'courseboard.reservation_policy',
  'golf/customers': 'courseboard.customers',
  'golf/customers/:customerId': 'courseboard.customers',
  'golf/customers/call-list': 'courseboard.customers',
  'settings/customer-grades': 'courseboard.customers',
  'golf/customers/reception': 'courseboard.customers.reception',
  'settings/reception-fields': 'courseboard.customers.reception',
  'golf/customers/cancellations': 'courseboard.customers.cancellations',
  'settings/membership-plans': 'courseboard.membership',
  'settings/membership-discounts': 'courseboard.membership',
  'settings/membership-play-windows': 'courseboard.membership',
  'golf/caddies': 'courseboard.caddies',
  'golf/caddies/:caddieId': 'courseboard.caddies',
  'golf/caddies/dispatch': 'courseboard.caddies.dispatch',
  'settings/caddie-duties': 'courseboard.caddies.dispatch',
  'golf/caddies/shifts': 'courseboard.caddies.shifts',
  'golf/caddies/attendance': 'courseboard.caddies.insights',
  'golf/caddies/payroll': 'courseboard.caddies.payroll',
  'staff': 'courseboard.staff',
  'staff/:staffId': 'courseboard.staff',
  'golf/budgets': 'courseboard.budgets',
  'golf/settlement': 'courseboard.settlement',
  'golf/simulator': 'courseboard.fee_simulator',
  'golf/reservation-report-import': 'courseboard.reservation_report_import',
  'golf/data-imports/courseboardReservationReports/documents': 'courseboard.reservation_report_import',
  'golf/data-imports/courseboardReservationReports/documents/:jobId': 'courseboard.reservation_report_import',
  'golf/data-imports': 'courseboard.data_imports',
  'golf/data-imports/:target': 'courseboard.data_imports',
  'settings/data-exports': 'courseboard.data_exports',
  'cancellation-fees': 'courseboard.cancellation_fee',
  'cancellation-fees/new': 'courseboard.cancellation_fee',
  'cancellation-fees/:invoiceId': 'courseboard.cancellation_fee',
  'course-map': 'courseboard.course_map',
})

/**
 * Screens no plan gates: hubs that filter their own links, the tenant's own
 * member administration (Field's), and the public pages.
 */
export const EXEMPT_ROUTES: ReadonlySet<string> = new Set([
  'golf',
  'settings',
  'settings/members',
  'download',
  'privacy',
  'terms',
  'pay/:token',
])

/** `golf/reservation-products` is the older name of the product screens. */
const ROUTE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['golf/reservation-products', 'golf/products'],
]

function patternMatches(pattern: string, route: string) {
  const patternSegments = pattern.split('/')
  const routeSegments = route.split('/')
  if (patternSegments.length !== routeSegments.length) return false
  return patternSegments.every((segment, index) => (
    segment.startsWith(':') ? routeSegments[index] !== '' : segment === routeSegments[index]
  ))
}

function canonicalRoute(route: string) {
  for (const [alias, target] of ROUTE_ALIASES) {
    if (route === alias || route.startsWith(`${alias}/`)) return target + route.slice(alias.length)
  }
  return route
}

/**
 * The feature a route needs, `null` for an exempt route, `undefined` for a
 * route this table does not know (the router answers it with NotFound).
 * Literal patterns win over parameterised ones (`golf/customers/reception`
 * before `golf/customers/:customerId`).
 */
export function routeFeatureKey(route: string): FeatureKey | null | undefined {
  const target = canonicalRoute(route)
  if ([...EXEMPT_ROUTES].some(pattern => patternMatches(pattern, target))) return null
  const patterns = Object.keys(ROUTE_FEATURES)
  const literal = patterns.find(pattern => !pattern.includes(':') && pattern === target)
  if (literal) return ROUTE_FEATURES[literal]
  const parameterised = patterns.find(pattern => pattern.includes(':') && patternMatches(pattern, target))
  return parameterised ? ROUTE_FEATURES[parameterised] : undefined
}
