import { FEATURE_FLAG_KEYS, useFeatureFlag } from './FeatureFlags'

/**
 * Routes that only exist once the tenant's flag says so.
 *
 * One table, read by everything that can send someone to a screen: the router,
 * the sidebar, the pinned list, and the home tiles. Spreading the route string
 * across those call sites is how a screen ends up hidden from the sidebar and
 * still reachable from a tile that leads to a 404.
 */
export const ROUTE_FEATURE_FLAGS: Readonly<Record<string, string>> = Object.freeze({
  'golf/reservation-report-import': FEATURE_FLAG_KEYS.reservationReportImport,
})

export type RouteGate = 'visible' | 'hidden' | 'loading'

/**
 * Whether a route may be shown.
 *
 * A flag is a rollout switch, not an authorization check — the route still
 * passes through the API's own authz — so an evaluation the provider could not
 * answer leaves the screen up. Hiding on a provider blip would take a working
 * screen away from the desk with nothing to explain it, which is the opposite
 * of what CLAUDE.md asks for when an upstream is down. Only a flag that came
 * back and said "off" hides anything.
 */
export function routeGateFrom(
  flagKey: string | undefined,
  state: { enabled: boolean; error: boolean; isLoading: boolean },
): RouteGate {
  if (!flagKey) return 'visible'
  if (state.error) return 'visible'
  if (state.isLoading) return 'loading'
  return state.enabled ? 'visible' : 'hidden'
}

/** The gate for one route. Safe to call for routes that carry no flag. */
export function useRouteGate(route: string): RouteGate {
  const flagKey = ROUTE_FEATURE_FLAGS[route]
  // Hooks cannot be called conditionally; an empty key reads as a missing flag
  // and `routeGateFrom` ignores the state that comes back with it.
  const state = useFeatureFlag(flagKey ?? '')
  return routeGateFrom(flagKey, state)
}

/**
 * The flagged routes that must not be offered right now.
 *
 * `loading` is deliberately not hidden here: a link that appears a moment late
 * is less confusing than one that blinks out of the sidebar on every reload.
 * The router still holds the wait, so following a stale link lands on the
 * loader rather than on a 404.
 */
export function useHiddenRoutes(): ReadonlySet<string> {
  const reservationReportImport = useRouteGate('golf/reservation-report-import')
  const hidden = new Set<string>()
  if (reservationReportImport === 'hidden') hidden.add('golf/reservation-report-import')
  return hidden
}
