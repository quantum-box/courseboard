import { type NextRequest, NextResponse } from 'next/server'

const legacyReportRedirects = new Map<string, string>([
	['/analytics', '/reports/sales'],
	['/analytics/reports', '/reports/automated'],
	['/erp/reports', '/reports'],
	['/accounting/reports', '/reports'],
	['/accounting/report', '/reports'],
])

export function middleware(request: NextRequest) {
	const { pathname, search } = request.nextUrl
	const sandboxPrefix = pathname.startsWith('/sandbox') ? '/sandbox' : ''
	const pathWithoutMode = sandboxPrefix
		? pathname.replace(/^\/sandbox/, '') || '/'
		: pathname
	const [, tenant, ...routeParts] = pathWithoutMode.split('/')

	if (!tenant) {
		return NextResponse.next()
	}

	const legacyRoute = `/${routeParts.join('/')}`
	const canonicalRoute = legacyReportRedirects.get(legacyRoute)

	if (!canonicalRoute) {
		return NextResponse.next()
	}

	const url = request.nextUrl.clone()
	url.pathname = `${sandboxPrefix}/${tenant}${canonicalRoute}`
	url.search = search
	return NextResponse.redirect(url)
}

export const config = {
	matcher: [
		'/:tenant/analytics',
		'/:tenant/analytics/reports',
		'/:tenant/erp/reports',
		'/:tenant/accounting/reports',
		'/:tenant/accounting/report',
		'/sandbox/:tenant/analytics',
		'/sandbox/:tenant/analytics/reports',
		'/sandbox/:tenant/erp/reports',
		'/sandbox/:tenant/accounting/reports',
		'/sandbox/:tenant/accounting/report',
	],
}
