import {
	loadCourseboardTenants,
	resolveBearerCourseboardPrincipal,
	toCourseboardPublicContext,
} from 'lib/courseboard-auth-context'
import {
	applyNativeCors,
	isRejectedCrossOrigin,
	nativeCorsPreflight,
} from 'lib/native-cors'

export const runtime = 'edge'

const ALLOWED_METHODS = ['GET'] as const

function json(
	request: Request,
	body: unknown,
	init: ResponseInit = {},
) {
	const headers = new Headers(init.headers)
	headers.set('cache-control', 'no-store')
	return applyNativeCors(
		request,
		Response.json(body, { ...init, headers }),
	)
}

function unauthorized(request: Request) {
	return json(
		request,
		{ code: 'UNAUTHORIZED', message: 'A valid bearer token is required' },
		{ status: 401 },
	)
}

export async function OPTIONS(request: Request) {
	return nativeCorsPreflight(request, ALLOWED_METHODS)
}

export async function GET(request: Request) {
	if (isRejectedCrossOrigin(request)) {
		return json(
			request,
			{ code: 'FORBIDDEN_ORIGIN', message: 'Origin is not allowed' },
			{ status: 403 },
		)
	}

	const principal = await resolveBearerCourseboardPrincipal(request)
	if (!principal) return unauthorized(request)

	const tenantResult = await loadCourseboardTenants(principal)
	if (tenantResult.kind === 'unauthorized') return unauthorized(request)
	if (tenantResult.kind === 'unavailable') {
		return json(
			request,
			{
				code: 'TENANT_DIRECTORY_UNAVAILABLE',
				message: 'Tenant authorization is temporarily unavailable',
			},
			{ status: 503 },
		)
	}

	const context = toCourseboardPublicContext(
		tenantResult.session,
		tenantResult.tenants,
		tenantResult.partial,
	)
	return context ? json(request, context) : unauthorized(request)
}
