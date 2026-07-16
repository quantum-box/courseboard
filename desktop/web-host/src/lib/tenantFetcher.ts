import type { Session } from 'next-auth'
import { cache } from 'react'
import type { TachyonFieldMode } from './mode'
import { OPERATOR_IDS, PLATFORM_IDS } from './mode'
import { getServerBackendBaseUrl } from './serverBackendUrl'
import {
	FIELD_ADMIN_TENANT_ACCESS_ACTION,
	dedupeTenants,
	normalizeTenantListResponse,
	withTenantMode,
	type Tenant,
} from './tenant-list'

export { FIELD_ADMIN_TENANT_ACCESS_ACTION, type Tenant }

const TENANT_LIST_CACHE_TTL_MS = 60_000
const TENANT_LIST_CACHE_MAX_ENTRIES = 256
const tenantListCache = new Map<
	string,
	{ expiresAt: number; tenants: Tenant[] }
>()

function cloneTenants(tenants: Tenant[]) {
	return tenants.map(tenant => ({ ...tenant }))
}

export class TenantFetchError extends Error {
	status: number

	constructor(status: number, message: string) {
		super(`Failed to fetch tenants: ${status} ${message}`)
		this.name = 'TenantFetchError'
		this.status = status
	}
}

export class TenantFetchPartialError extends Error {
	tenants: Tenant[]
	cause: unknown

	constructor(tenants: Tenant[], cause: unknown) {
		super(
			cause instanceof Error
				? cause.message
				: 'Failed to fetch all tenant platforms',
		)
		this.name = 'TenantFetchPartialError'
		this.tenants = cloneTenants(tenants)
		this.cause = cause
	}
}

export function isTenantFetchUnauthorized(error: unknown) {
	return error instanceof TenantFetchError && error.status === 401
}

export function getPartialTenantFetchTenants(error: unknown) {
	return error instanceof TenantFetchPartialError
		? cloneTenants(error.tenants)
		: undefined
}

function isTenantFetchAuthorizationError(error: unknown) {
	return (
		error instanceof TenantFetchError &&
		(error.status === 401 || error.status === 403)
	)
}

type FetchTenantsOptions = {
	refreshSession?: () => Promise<Session | null>
}

async function fetchTenantsForPlatform(
	session: Session,
	mode: TachyonFieldMode,
	options: { ignoreUnauthorized?: boolean } = {},
): Promise<Tenant[]> {
	const endpoint = getServerBackendBaseUrl()
	const url = new URL('/get_tenants', endpoint)
	url.searchParams.set('required_action', FIELD_ADMIN_TENANT_ACCESS_ACTION)
	const headers: Record<string, string> = {
		Authorization: `Bearer ${session.accessToken}`,
		'x-platform-id': PLATFORM_IDS[mode],
		'x-operator-id': OPERATOR_IDS[mode],
	}
	const res = await fetch(url.toString(), {
		method: 'POST',
		cache: 'no-store',
		headers,
	})

	if (!res.ok) {
		const body = await res.json().catch(() => ({}))
		if (
			options.ignoreUnauthorized &&
			(res.status === 401 || res.status === 403)
		) {
			return []
		}

		throw new TenantFetchError(res.status, body.message ?? res.statusText)
	}

	const data = await res.json()
	return normalizeTenantListResponse(data).map(withTenantMode)
}

const fetchTenantsForKnownPlatforms = cache(
	async function fetchTenantsForKnownPlatforms(
		session: Session,
	): Promise<Tenant[]> {
		const results = await Promise.allSettled([
			fetchTenantsForPlatform(session, 'production'),
			fetchTenantsForPlatform(session, 'sandbox'),
		])
		const tenants = results.flatMap(result =>
			result.status === 'fulfilled' ? result.value : [],
		)
		const nonAuthorizationFailures = results.filter(
			(result): result is PromiseRejectedResult =>
				result.status === 'rejected' &&
				!isTenantFetchAuthorizationError(result.reason),
		)

		if (nonAuthorizationFailures.length > 0) {
			if (tenants.length > 0) {
				throw new TenantFetchPartialError(
					tenants,
					nonAuthorizationFailures[0].reason,
				)
			}
			throw nonAuthorizationFailures[0].reason
		}

		if (tenants.length > 0) {
			return tenants
		}

		for (const result of results) {
			if (result.status === 'rejected') {
				throw result.reason
			}
		}

		return []
	},
)

async function tenantListCacheKey(
	session: Session,
): Promise<string | undefined> {
	if (!session.accessToken) return undefined
	const subtle = globalThis.crypto?.subtle
	if (!subtle) return undefined

	const digest = await subtle.digest(
		'SHA-256',
		new TextEncoder().encode(session.accessToken),
	)
	return Array.from(new Uint8Array(digest))
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')
}

function readTenantListCache(
	key: string,
	now = Date.now(),
): Tenant[] | undefined {
	const cached = tenantListCache.get(key)
	if (!cached) return undefined
	if (cached.expiresAt <= now) {
		tenantListCache.delete(key)
		return undefined
	}
	return cloneTenants(cached.tenants)
}

function writeTenantListCache(
	key: string,
	tenants: Tenant[],
	now = Date.now(),
) {
	if (tenantListCache.size >= TENANT_LIST_CACHE_MAX_ENTRIES) {
		const firstKey = tenantListCache.keys().next().value
		if (firstKey) tenantListCache.delete(firstKey)
	}
	tenantListCache.set(key, {
		expiresAt: now + TENANT_LIST_CACHE_TTL_MS,
		tenants: cloneTenants(tenants),
	})
}

export function clearTenantFetcherCacheForTests() {
	tenantListCache.clear()
}

export default async function fetchTenants(
	session: Session,
	options: FetchTenantsOptions = {},
): Promise<Tenant[]> {
	let activeSession = session
	let cacheKey = await tenantListCacheKey(activeSession)
	const cachedTenants = cacheKey ? readTenantListCache(cacheKey) : undefined
	if (cachedTenants) return cachedTenants

	let all: Tenant[]
	try {
		all = await fetchTenantsForKnownPlatforms(activeSession)
	} catch (error) {
		if (!isTenantFetchUnauthorized(error) || !options.refreshSession) {
			throw error
		}
		const refreshedSession = await options.refreshSession()
		if (!refreshedSession?.accessToken) {
			throw error
		}
		activeSession = refreshedSession
		cacheKey = await tenantListCacheKey(activeSession)
		const refreshedCachedTenants = cacheKey
			? readTenantListCache(cacheKey)
			: undefined
		if (refreshedCachedTenants) return refreshedCachedTenants
		all = await fetchTenantsForKnownPlatforms(activeSession)
	}

	const deduped = dedupeTenants(all)
	if (cacheKey) writeTenantListCache(cacheKey, deduped)
	return deduped
}
