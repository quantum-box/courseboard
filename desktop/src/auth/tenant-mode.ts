import type { AuthTenantMode } from './types'

export type TenantModeBadge = {
  variant: 'success' | 'warning' | 'neutral'
  label: AuthTenantMode
}

function unexpectedTenantMode(_mode: never): TenantModeBadge {
  // Keep an untyped/stale persisted value honest at runtime as well. Passing a
  // newly-added union member here fails type-check until the switch handles it.
  return { variant: 'neutral', label: 'unknown' }
}

/** Exhaustive presentation for every tenant environment state. */
export function tenantModeBadge(mode: AuthTenantMode): TenantModeBadge {
  switch (mode) {
    case 'production':
      return { variant: 'success', label: 'production' }
    case 'sandbox':
      return { variant: 'warning', label: 'sandbox' }
    case 'unknown':
      return { variant: 'neutral', label: 'unknown' }
    default:
      return unexpectedTenantMode(mode)
  }
}
