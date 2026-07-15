import type { AuthTenant } from './types'

export function resolveTenantSelection(
  tenants: AuthTenant[],
  requested: string | null,
  saved: string | null,
) {
  if (requested) {
    const tenant = tenants.find(candidate => candidate.id === requested)
    return { tenant, requestedMissing: !tenant }
  }
  return {
    tenant: tenants.find(candidate => candidate.id === saved)
      ?? (tenants.length === 1 ? tenants[0] : undefined),
    requestedMissing: false,
  }
}
