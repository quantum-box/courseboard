import { describe, expect, it } from 'vitest'
import { resolveTenantSelection } from './tenant-selection'
import type { AuthTenant } from './types'

const tenants: AuthTenant[] = [
  {
    id: 'tenant-a',
    name: 'A',
    mode: 'production',
    operatorId: 'tenant-a',
    platformId: 'platform-production',
  },
  {
    id: 'tenant-b',
    name: 'B',
    mode: 'sandbox',
    operatorId: 'tenant-b',
    platformId: 'platform-sandbox',
  },
]

describe('resolveTenantSelection', () => {
  it('does not fall back when an explicit tenant is unauthorized', () => {
    expect(resolveTenantSelection(tenants, 'tenant-missing', 'tenant-a')).toEqual({
      tenant: undefined,
      requestedMissing: true,
    })
  })

  it('honors an authorized explicit tenant before the saved tenant', () => {
    expect(resolveTenantSelection(tenants, 'tenant-b', 'tenant-a')).toEqual({
      tenant: tenants[1],
      requestedMissing: false,
    })
  })

  it('uses the saved tenant only when no explicit tenant is present', () => {
    expect(resolveTenantSelection(tenants, null, 'tenant-a')).toEqual({
      tenant: tenants[0],
      requestedMissing: false,
    })
  })
})
