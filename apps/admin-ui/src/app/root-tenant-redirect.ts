import type { Tenant } from 'lib/tenantFetcher'

export function getTenantHomePath(tenant: Pick<Tenant, 'id' | 'mode'>): string {
	const prefix = tenant.mode === 'sandbox' ? '/sandbox' : ''
	return `${prefix}/${tenant.id}/home`
}

export function getRootTenantOptions(tenants: Tenant[]): Tenant[] {
	return tenants
}
