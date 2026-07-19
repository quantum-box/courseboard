import { describe, expect, it } from 'vitest'
import { formatTenantWorkspaceLabel, tenantWorkspaceLabel } from './tenant-label'
import type { AuthTenant } from './types'

function tenant(overrides: Partial<AuthTenant> & Pick<AuthTenant, 'id'>): AuthTenant {
  return {
    name: overrides.id,
    mode: 'production',
    operatorId: overrides.id,
    platformId: 'platform-production',
    ...overrides,
  }
}

describe('tenantWorkspaceLabel', () => {
  it('shows name and slug when both are human-readable', () => {
    expect(tenantWorkspaceLabel(tenant({
      id: 'tn_01example',
      name: 'Sapporo Country Club',
      slug: 'scc',
    }))).toEqual({
      primary: 'Sapporo Country Club',
      secondary: 'scc',
    })
  })

  it('falls back to slug when name is missing or equals id', () => {
    expect(tenantWorkspaceLabel(tenant({
      id: 'tn_01example',
      name: 'tn_01example',
      slug: 'scc',
    }))).toEqual({ primary: 'scc' })
  })

  it('falls back to id when name and slug are unavailable', () => {
    expect(formatTenantWorkspaceLabel(tenant({ id: 'tn_01example' }))).toBe('tn_01example')
  })

  it('omits a secondary slug that duplicates the name', () => {
    expect(formatTenantWorkspaceLabel(tenant({
      id: 'tn_01example',
      name: 'scc',
      slug: 'scc',
    }))).toBe('scc')
  })
})
