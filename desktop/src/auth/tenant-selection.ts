import type { AuthTenant } from './types'

/** A tenant without a resolved platform cannot be bound to API calls. */
export function isSelectableTenant(tenant: AuthTenant) {
  return !tenant.platformUnresolved
}

export function resolveTenantSelection(
  tenants: AuthTenant[],
  requested: string | null,
  saved: string | null,
) {
  if (requested) {
    const tenant = tenants.find(candidate => candidate.id === requested)
    // A listed but unresolved tenant goes to the picker, which explains why
    // it cannot be opened, instead of reading as "no access".
    return {
      tenant: tenant && isSelectableTenant(tenant) ? tenant : undefined,
      requestedMissing: !tenant,
    }
  }
  const savedTenant = tenants.find(candidate => candidate.id === saved)
  return {
    tenant: (savedTenant && isSelectableTenant(savedTenant) ? savedTenant : undefined)
      ?? (tenants.length === 1 && isSelectableTenant(tenants[0]) ? tenants[0] : undefined),
    requestedMissing: false,
  }
}
