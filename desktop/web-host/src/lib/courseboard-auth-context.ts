import {
	auth,
	refreshAuthSession,
	verifyAccessToken,
} from 'app/auth'
import type { Session } from 'next-auth'
import { PLATFORM_IDS } from './mode'
import fetchTenants, {
	TenantFetchError,
	getPartialTenantFetchTenants,
	isTenantFetchUnauthorized,
	type Tenant,
} from './tenantFetcher'

const MAX_BEARER_TOKEN_LENGTH = 16_384
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9\-._~+/]+=*$/

export type CourseboardPrincipal = {
	session: Session
	source: 'web-session' | 'bearer'
}

export type CourseboardTenantResult =
	| {
			kind: 'ok'
			session: Session
			tenants: Tenant[]
			partial: boolean
	  }
	| { kind: 'unauthorized' }
	| { kind: 'unavailable' }

export type CourseboardPublicContext = {
	user: {
		id: string
		username?: string
		name?: string | null
		email?: string | null
		role: string
	}
	tenants: Array<{
		id: string
		name: string
		slug?: string
		mode: Tenant['mode']
		platformId: string
		operatorId: string
	}>
	partial: boolean
}

export function isUsableCourseboardSession(
	session: Session | null | undefined,
): session is Session {
	return Boolean(
		session?.accessToken &&
			session.user?.id &&
			!session.error,
	)
}

function readBearerToken(request: Request): string | undefined {
	const authorization = request.headers.get('authorization')
	if (!authorization) return undefined

	const match = /^Bearer ([^\s]+)$/.exec(authorization)
	const token = match?.[1]
	if (
		!token ||
		token.length > MAX_BEARER_TOKEN_LENGTH ||
		!BEARER_TOKEN_PATTERN.test(token)
	) {
		return undefined
	}
	return token
}

async function principalFromBearer(
	request: Request,
): Promise<CourseboardPrincipal | undefined> {
	const accessToken = readBearerToken(request)
	if (!accessToken) return undefined

	try {
		const verification = (await verifyAccessToken(accessToken)) as {
			user?: {
				id?: unknown
				role?: unknown
				tenants?: unknown
			}
		}
		if (typeof verification.user?.id !== 'string') return undefined
		const tenants = Array.isArray(verification.user.tenants)
			? verification.user.tenants.filter(
					(tenant): tenant is string => typeof tenant === 'string',
				)
			: undefined
		const session = {
			accessToken,
			expires: new Date(Date.now() + 5 * 60_000).toISOString(),
			user: {
				id: verification.user.id,
				username: verification.user.id,
				role:
					typeof verification.user.role === 'string'
						? verification.user.role
						: 'GENERAL',
				...(tenants ? { tenants } : {}),
			},
		} as Session
		return { session, source: 'bearer' }
	} catch {
		return undefined
	}
}

export async function resolveWebCourseboardPrincipal(): Promise<
	CourseboardPrincipal | undefined
> {
	const session = await auth()
	return isUsableCourseboardSession(session)
		? { session, source: 'web-session' }
		: undefined
}

export async function resolveBearerCourseboardPrincipal(
	request: Request,
): Promise<CourseboardPrincipal | undefined> {
	return principalFromBearer(request)
}

export async function resolveFieldCourseboardPrincipal(
	request: Request,
): Promise<CourseboardPrincipal | undefined> {
	const webPrincipal = await resolveWebCourseboardPrincipal()
	return webPrincipal ?? principalFromBearer(request)
}

async function fetchCourseboardTenantsOnce(
	session: Session,
): Promise<CourseboardTenantResult> {
	try {
		return {
			kind: 'ok',
			session,
			tenants: await fetchTenants(session),
			partial: false,
		}
	} catch (error) {
		const partialTenants = getPartialTenantFetchTenants(error)
		if (partialTenants) {
			return {
				kind: 'ok',
				session,
				tenants: partialTenants,
				partial: true,
			}
		}
		if (isTenantFetchUnauthorized(error)) {
			return { kind: 'unauthorized' }
		}
		if (error instanceof TenantFetchError && error.status === 403) {
			return {
				kind: 'ok',
				session,
				tenants: [],
				partial: false,
			}
		}
		return { kind: 'unavailable' }
	}
}

export async function loadCourseboardTenants(
	principal: CourseboardPrincipal,
): Promise<CourseboardTenantResult> {
	const firstResult = await fetchCourseboardTenantsOnce(principal.session)
	if (
		firstResult.kind !== 'unauthorized' ||
		principal.source !== 'web-session'
	) {
		return firstResult
	}

	try {
		const refreshedSession = await refreshAuthSession()
		if (!isUsableCourseboardSession(refreshedSession)) {
			return { kind: 'unauthorized' }
		}
		return fetchCourseboardTenantsOnce(refreshedSession)
	} catch {
		return { kind: 'unauthorized' }
	}
}

export function toCourseboardPublicContext(
	session: Session,
	tenants: Tenant[],
	partial: boolean,
): CourseboardPublicContext | undefined {
	const user = session.user
	if (!user?.id) return undefined
	const displayName = (user as { name?: unknown }).name

	return {
		user: {
			id: user.id,
			...(user.username ? { username: user.username } : {}),
				...(typeof displayName === 'string' || displayName === null
					? { name: displayName }
					: {}),
			...(user.email !== undefined ? { email: user.email } : {}),
			role: user.role ?? 'GENERAL',
		},
		tenants: tenants.map(tenant => ({
			id: tenant.id,
			name: tenant.name,
			...(tenant.slug ? { slug: tenant.slug } : {}),
			mode: tenant.mode,
			platformId: PLATFORM_IDS[tenant.mode],
			operatorId: tenant.id,
		})),
		partial,
	}
}
