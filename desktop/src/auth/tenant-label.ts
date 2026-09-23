import type { AuthTenant } from './types'

export type TenantWorkspaceLabel = {
  primary: string
  secondary?: string
}

/**
 * Prefer human-readable tenant name + slug for chrome labels.
 * Falls back to id only when neither name nor slug is usable.
 */
export function tenantWorkspaceLabel(tenant: AuthTenant): TenantWorkspaceLabel {
  const name = tenant.name?.trim()
  const slug = tenant.slug?.trim()
  const distinctName = name && name !== tenant.id ? name : undefined
  const distinctSlug = slug && slug !== distinctName ? slug : undefined

  if (distinctName && distinctSlug) {
    return { primary: distinctName, secondary: distinctSlug }
  }
  if (distinctName) return { primary: distinctName }
  if (slug) return { primary: slug }
  return { primary: tenant.id }
}

export function formatTenantWorkspaceLabel(tenant: AuthTenant): string {
  const { primary, secondary } = tenantWorkspaceLabel(tenant)
  return secondary ? `${primary} · ${secondary}` : primary
}
