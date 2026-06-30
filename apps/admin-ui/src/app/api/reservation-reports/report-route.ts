import { authWithCheck } from 'app/auth'
import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { type NextRequest, NextResponse } from 'next/server'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export async function proxyReservationReport(
	req: NextRequest,
	report: string,
	upstreamPath: string,
) {
	const tenant = req.nextUrl.searchParams.get('tenant')?.trim()

	if (!tenant) {
		return NextResponse.json({ error: 'tenant is required' }, { status: 400 })
	}

	const search = new URLSearchParams()
	for (const key of ['from', 'to']) {
		const value = req.nextUrl.searchParams.get(key)
		if (value) search.set(key, value)
	}

	const session = await authWithCheck()
	const upstream = `${joinServerBackendPath(upstreamPath)}${
		search.size > 0 ? `?${search.toString()}` : ''
	}`
	const res = await fetch(upstream, {
		headers: {
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
		},
		cache: 'no-store',
	})

	if (!res.ok) {
		const text = await res.text()
		return NextResponse.json(
			{ error: `Backend returned ${res.status}: ${text}` },
			{ status: res.status },
		)
	}

	const body = await res.text()
	const filename =
		res.headers.get('content-disposition') ?? `attachment; filename="${report}"`
	return new NextResponse(body, {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': filename,
		},
	})
}
