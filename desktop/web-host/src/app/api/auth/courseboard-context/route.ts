import {
	loadCourseboardTenants,
	resolveWebCourseboardPrincipal,
	toCourseboardPublicContext,
} from 'lib/courseboard-auth-context'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

function unauthorized() {
	return NextResponse.json(
		{ code: 'UNAUTHORIZED', message: 'Authentication is required' },
		{ status: 401, headers: { 'cache-control': 'no-store' } },
	)
}

export async function GET() {
	const principal = await resolveWebCourseboardPrincipal()
	if (!principal) return unauthorized()

	const tenantResult = await loadCourseboardTenants(principal)
	if (tenantResult.kind === 'unauthorized') return unauthorized()
	if (tenantResult.kind === 'unavailable') {
		return NextResponse.json(
			{
				code: 'TENANT_DIRECTORY_UNAVAILABLE',
				message: 'Tenant authorization is temporarily unavailable',
			},
			{ status: 503, headers: { 'cache-control': 'no-store' } },
		)
	}

	const context = toCourseboardPublicContext(
		tenantResult.session,
		tenantResult.tenants,
		tenantResult.partial,
	)
	if (!context) return unauthorized()

	return NextResponse.json(context, {
		headers: { 'cache-control': 'no-store' },
	})
}
