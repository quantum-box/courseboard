import type { EffectiveCapabilities } from './EffectiveCapabilitiesProvider'

/** Match the dedicated API's independent read and mutation actions. */
export function capabilityRouteAllowed(route: string, capabilities: EffectiveCapabilities) {
  if (route === 'cancellation-fees/new') return capabilities.cancellationFees.manage
  if (route === 'cancellation-fees' || route.startsWith('cancellation-fees/')) {
    return capabilities.cancellationFees.list
  }
  // Unknown navigation snapshots never authorize a business entry. The
  // bootstrap gate supplies retry UI before these route guards are mounted.
  return capabilities.navigation.otherBusinessAccess === true
}
