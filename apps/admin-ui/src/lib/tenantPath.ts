import type { Session } from 'next-auth'
import { OPERATOR_IDS } from './mode'
import fetchTenants, { type Tenant } from './tenantFetcher'

const TENANT_ULID_PATTERN = /^tn_[0-9a-z]+$/

export class TenantPathNotFoundError extends Error {
	constructor(tenant: string) {
		super(`Tenant path segment could not be resolved: ${tenant}`)
		this.name = 'TenantPathNotFoundError'
	}
}

export function isTenantUlid(value: string) {
	return TENANT_ULID_PATTERN.test(value)
}

export function findTenantByPathSegment(tenants: Tenant[], segment: string) {
	return tenants.find(
		tenant => tenant.id === segment || tenant.slug === segment,
	)
}

export async function resolveTenantPathSegment(
	session: Session,
	segment: string,
): Promise<Tenant | null> {
	if (isTenantUlid(segment)) {
		return {
			id: segment,
			name: segment,
			mode: segment === OPERATOR_IDS.sandbox ? 'sandbox' : 'production',
		}
	}

	const tenants = await fetchTenants(session)
	return findTenantByPathSegment(tenants, segment) ?? null
}

export async function resolveTenantOperatorId(
	session: Session,
	segment: string,
): Promise<string> {
	const tenant = await resolveTenantPathSegment(session, segment)
	if (!tenant) {
		throw new TenantPathNotFoundError(segment)
	}
	return tenant.id
}
