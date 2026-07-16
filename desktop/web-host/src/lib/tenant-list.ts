import { OPERATOR_IDS, PLATFORM_IDS, type TachyonFieldMode } from './mode'

export const FIELD_ADMIN_TENANT_ACCESS_ACTION = 'field:ViewSalesAnalytics'

export interface Tenant {
	id: string
	name: string
	slug?: string
	mode: TachyonFieldMode
	platformId?: string
}

export function getTenantMode(tenant: {
	id: string
	platformId?: string
}): TachyonFieldMode {
	if (
		tenant.id === OPERATOR_IDS.sandbox ||
		tenant.platformId === PLATFORM_IDS.sandbox ||
		tenant.platformId === OPERATOR_IDS.sandbox
	) {
		return 'sandbox'
	}
	if (
		tenant.id === OPERATOR_IDS.production ||
		tenant.platformId === PLATFORM_IDS.production ||
		tenant.platformId === OPERATOR_IDS.production
	) {
		return 'production'
	}
	return 'production'
}

export function normalizeTenantListResponse(
	data: unknown,
): Omit<Tenant, 'mode'>[] {
	if (!Array.isArray(data)) {
		throw new Error(`Expected tenant array, got ${typeof data}`)
	}
	return data.map(
		(t: { id: string; name: string; slug?: string; platformId?: string }) => ({
			id: t.id,
			name: t.name,
			...(t.slug ? { slug: t.slug } : {}),
			...(t.platformId ? { platformId: t.platformId } : {}),
		}),
	)
}

export function withTenantMode(tenant: Omit<Tenant, 'mode'>): Tenant {
	return {
		...tenant,
		mode: getTenantMode(tenant),
	}
}

export function dedupeTenants(tenants: Tenant[]): Tenant[] {
	const seen = new Set<string>()
	return tenants.filter(tenant => {
		if (seen.has(tenant.id)) return false
		seen.add(tenant.id)
		return true
	})
}
