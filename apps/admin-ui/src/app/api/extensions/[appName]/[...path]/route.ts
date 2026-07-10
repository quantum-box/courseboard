import { authWithCheck } from 'app/auth'
import {
	fetchCloudAppExtensions,
	findCloudAppExtension,
} from 'lib/cloud-app-extensions'
import {
	buildExtensionProxyFetchInit,
	buildExtensionProxyUrl,
	filterExtensionProxyResponseHeaders,
	isAllowedExtensionProxyMethod,
	isExtensionProxyRedirectStatus,
	isExtensionProxyTimeout,
} from 'lib/cloud-app-extension-proxy'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

type RouteContext = {
	params: {
		appName: string
		path?: string[]
	}
}

export async function GET(request: NextRequest, context: RouteContext) {
	return proxyExtensionRequest(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
	return proxyExtensionRequest(request, context)
}

export async function PUT(request: NextRequest, context: RouteContext) {
	return proxyExtensionRequest(request, context)
}

export async function PATCH(request: NextRequest, context: RouteContext) {
	return proxyExtensionRequest(request, context)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
	return proxyExtensionRequest(request, context)
}

async function proxyExtensionRequest(
	request: NextRequest,
	{ params }: RouteContext,
) {
	const method = request.method.toUpperCase()
	if (!isAllowedExtensionProxyMethod(method)) {
		return NextResponse.json(
			{ error: 'extension proxy method is not allowed' },
			{ status: 405 },
		)
	}

	const tenant = request.nextUrl.searchParams.get('tenant')
	if (!tenant) {
		return NextResponse.json(
			{ error: 'tenant query parameter is required' },
			{ status: 400 },
		)
	}

	const session = await authWithCheck()
	const registry = await fetchCloudAppExtensions(tenant)
	if (!registry.ok) {
		return NextResponse.json(
			{ error: registry.message },
			{ status: registry.status ?? 502 },
		)
	}

	const extension = findCloudAppExtension(registry.extensions, params.appName)
	if (!extension) {
		return NextResponse.json({ error: 'extension not found' }, { status: 404 })
	}

	const target = buildExtensionProxyUrl(
		extension,
		params.path ?? [],
		request.nextUrl.search,
	)
	if (!target.ok) {
		return NextResponse.json({ error: target.reason }, { status: 502 })
	}

	let upstream: Response
	try {
		upstream = await fetch(
			target.url.toString(),
			buildExtensionProxyFetchInit({
				method,
				requestHeaders: request.headers,
				accessToken: session.accessToken ?? '',
				body: request.body,
			}),
		)
	} catch (error) {
		if (isExtensionProxyTimeout(error)) {
			return NextResponse.json(
				{ error: 'extension proxy request timed out' },
				{ status: 504 },
			)
		}
		return NextResponse.json(
			{ error: 'extension proxy request failed' },
			{ status: 502 },
		)
	}

	if (isExtensionProxyRedirectStatus(upstream.status)) {
		return NextResponse.json(
			{ error: 'extension proxy redirect is not allowed' },
			{ status: 502 },
		)
	}

	return new NextResponse(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: filterExtensionProxyResponseHeaders(upstream.headers),
	})
}
