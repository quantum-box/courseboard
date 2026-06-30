import { authWithCheck } from 'app/auth'
import { fetchTenantName } from 'lib/tenantName'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

type RouteContext = {
	params: {
		tenant: string
	}
}

export async function GET(_request: Request, { params }: RouteContext) {
	const session = await authWithCheck()
	const tenantName = await fetchTenantName(session, params.tenant)

	return NextResponse.json({ tenantName })
}
