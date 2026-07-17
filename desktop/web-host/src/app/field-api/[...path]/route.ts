import {
	loadCourseboardTenants,
	resolveFieldCourseboardPrincipal,
} from 'lib/courseboard-auth-context'
import { PLATFORM_IDS } from 'lib/mode'
import {
	applyNativeCors,
	isRejectedCrossOrigin,
	nativeCorsPreflight,
} from 'lib/native-cors'
import { joinServerBackendPath } from 'lib/serverBackendUrl'

export const runtime = 'edge'

const MAX_PROXY_BODY_BYTES = 5 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 30_000
const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~:-]{1,256}$/
const TENANT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SCOPING_QUERY_KEYS = new Set([
	'operator',
	'operatorid',
	'platform',
	'platformid',
	'tenant',
	'tenantid',
	'xoperatorid',
	'xplatformid',
	'xtenantid',
])

type RouteContext = {
	params: {
		path?: string[]
	}
}

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

function proxyError(
	request: Request,
	status: number,
	code: string,
	message: string,
) {
	return json(request, { code, message }, { status })
}

function hasSafeSegments(path: string) {
	return (
		path.startsWith('/') &&
		path
			.slice(1)
			.split('/')
			.every(
				segment =>
					segment !== '.' &&
					segment !== '..' &&
					SAFE_PATH_SEGMENT_PATTERN.test(segment),
			)
	)
}

function isNonEmptySubpath(path: string, prefix: string) {
	const suffix = path.startsWith(`${prefix}/`)
		? path.slice(prefix.length + 1)
		: ''
	return Boolean(suffix)
}

function hasExactSuffixSegments(
	path: string,
	prefix: string,
	suffixSegments: readonly string[],
) {
	if (!path.startsWith(`${prefix}/`)) return false
	const segments = path.slice(prefix.length + 1).split('/')
	if (segments.length !== suffixSegments.length + 1) return false
	return suffixSegments.every(
		(segment, index) => segments[index + 1] === segment,
	)
}

function hasSingleResourceId(path: string, prefix: string) {
	if (!path.startsWith(`${prefix}/`)) return false
	return path.slice(prefix.length + 1).split('/').length === 1
}

export function isAllowedFieldRoute(method: string, path: string) {
	if (!hasSafeSegments(path)) return false
	const normalizedMethod = method.toUpperCase()

	if (
		path === '/v1/erp/extensions/status' ||
		path === '/v1/erp/reservation-types'
	) {
		return normalizedMethod === 'GET'
	}
	if (path === '/v1/erp/extensions/golf_course/config') {
		return normalizedMethod === 'GET' || normalizedMethod === 'PATCH'
	}
	if (path === '/v1/erp/extensions/golf-course') {
		return normalizedMethod === 'GET'
	}
	if (isNonEmptySubpath(path, '/v1/erp/extensions/golf-course')) {
		return (ALLOWED_METHODS as readonly string[]).includes(normalizedMethod)
	}
	if (path === '/v1/erp/staff') {
		return normalizedMethod === 'GET' || normalizedMethod === 'POST'
	}
	if (isNonEmptySubpath(path, '/v1/erp/staff')) {
		return normalizedMethod === 'POST'
	}
	if (
		hasExactSuffixSegments(path, '/v1/erp/reservations', [
			'billing-invoice',
		])
	) {
		return normalizedMethod === 'POST'
	}
	if (path === '/v1/invoices') {
		return normalizedMethod === 'GET' || normalizedMethod === 'POST'
	}
	if (hasExactSuffixSegments(path, '/v1/invoices', ['fulfill'])) {
		return normalizedMethod === 'POST'
	}
	if (hasSingleResourceId(path, '/v1/invoices')) {
		return normalizedMethod === 'GET' || normalizedMethod === 'PATCH'
	}
	if (hasSingleResourceId(path, '/v1/erp/orders')) {
		return normalizedMethod === 'GET'
	}
	return false
}

function normalizedFieldPath(pathSegments: string[] | undefined) {
	if (!pathSegments?.length) return undefined
	const path = `/${pathSegments.join('/')}`
	return hasSafeSegments(path) ? path : undefined
}

function hasScopingQueryParameter(url: URL) {
	let found = false
	url.searchParams.forEach((_value, key) => {
		const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
		if (SCOPING_QUERY_KEYS.has(normalized)) found = true
	})
	return found
}

async function readProxyBody(request: Request) {
	if (request.method === 'GET') {
		return { ok: true as const, body: undefined }
	}

	const contentLength = request.headers.get('content-length')
	if (
		contentLength &&
		(!/^\d+$/.test(contentLength) ||
			Number(contentLength) > MAX_PROXY_BODY_BYTES)
	) {
		return { ok: false as const }
	}
	const body = await request.arrayBuffer()
	return body.byteLength <= MAX_PROXY_BODY_BYTES
		? { ok: true as const, body: body.byteLength > 0 ? body : undefined }
		: { ok: false as const }
}

function safePassthroughHeader(
	request: Request,
	name: string,
	maxLength: number,
) {
	const value = request.headers.get(name)
	return value && value.length <= maxLength ? value : undefined
}

async function proxyFieldRequest(
	request: Request,
	{ params }: RouteContext,
) {
	const path = normalizedFieldPath(params.path)
	if (!path || !isAllowedFieldRoute(request.method, path)) {
		return proxyError(
			request,
			404,
			'FIELD_PATH_NOT_AVAILABLE',
			'Field API path is not available',
		)
	}
	if (isRejectedCrossOrigin(request)) {
		return proxyError(
			request,
			403,
			'FORBIDDEN_ORIGIN',
			'Origin is not allowed',
		)
	}

	const incomingUrl = new URL(request.url)
	if (hasScopingQueryParameter(incomingUrl)) {
		return proxyError(
			request,
			400,
			'INVALID_SCOPE',
			'Tenant and platform scope must be sent through the authenticated context',
		)
	}

	const operatorId = request.headers.get('x-operator-id')
	if (!operatorId || !TENANT_ID_PATTERN.test(operatorId)) {
		return proxyError(
			request,
			400,
			'INVALID_OPERATOR',
			'A valid x-operator-id header is required',
		)
	}

	const principal = await resolveFieldCourseboardPrincipal(request)
	if (!principal) {
		return proxyError(
			request,
			401,
			'UNAUTHORIZED',
			'Authentication is required',
		)
	}
	const tenantResult = await loadCourseboardTenants(principal)
	if (tenantResult.kind === 'unauthorized') {
		return proxyError(
			request,
			401,
			'UNAUTHORIZED',
			'Authentication has expired',
		)
	}
	if (tenantResult.kind === 'unavailable') {
		return proxyError(
			request,
			503,
			'TENANT_DIRECTORY_UNAVAILABLE',
			'Tenant authorization is temporarily unavailable',
		)
	}

	const authorizedTenant = tenantResult.tenants.find(
		tenant => tenant.id === operatorId,
	)
	if (!authorizedTenant) {
		return tenantResult.partial
			? proxyError(
					request,
					503,
					'TENANT_DIRECTORY_PARTIAL',
					'Tenant authorization could not be confirmed',
				)
			: json(
					request,
					{
						code: 'FORBIDDEN',
						message: 'Tenant access is forbidden',
					},
					{
						status: 403,
						headers: { 'x-courseboard-auth-denial': 'tenant' },
					},
				)
	}

	const idempotencyKey = request.headers.get('idempotency-key')
	if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
		return proxyError(
			request,
			400,
			'INVALID_IDEMPOTENCY_KEY',
			'Idempotency-Key is invalid',
		)
	}
	const requestBody = await readProxyBody(request)
	if (!requestBody.ok) {
		return proxyError(
			request,
			413,
			'PAYLOAD_TOO_LARGE',
			'Request body is too large',
		)
	}

	const upstreamUrl = new URL(joinServerBackendPath(path))
	upstreamUrl.search = incomingUrl.search
	const headers = new Headers({
		accept: safePassthroughHeader(request, 'accept', 512) ?? 'application/json',
		authorization: `Bearer ${tenantResult.session.accessToken}`,
		'x-operator-id': authorizedTenant.id,
		'x-platform-id': PLATFORM_IDS[authorizedTenant.mode],
	})
	for (const [name, maxLength] of [
		['content-type', 256],
		['if-match', 512],
	] as const) {
		const value = safePassthroughHeader(request, name, maxLength)
		if (value) headers.set(name, value)
	}
	if (idempotencyKey) headers.set('idempotency-key', idempotencyKey)

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
	try {
		const upstream = await fetch(upstreamUrl, {
			method: request.method,
			headers,
			body: requestBody.body,
			cache: 'no-store',
			redirect: 'manual',
			signal: controller.signal,
		})
		if (upstream.status === 401 && principal.source === 'bearer') {
			return proxyError(
				request,
				502,
				'FIELD_API_OAUTH_INCOMPATIBLE',
				'Field API rejected a token already verified by Tachyon Auth',
			)
		}
		const responseHeaders = new Headers({ 'cache-control': 'no-store' })
		for (const name of ['content-type', 'content-disposition', 'etag']) {
			const value = upstream.headers.get(name)
			if (value) responseHeaders.set(name, value)
		}
		return applyNativeCors(
			request,
			new Response(upstream.body, {
				status: upstream.status,
				statusText: upstream.statusText,
				headers: responseHeaders,
			}),
		)
	} catch {
		return proxyError(
			request,
			502,
			'FIELD_API_UNAVAILABLE',
			'Field API request failed',
		)
	} finally {
		clearTimeout(timeout)
	}
}

export async function OPTIONS(request: Request) {
	return nativeCorsPreflight(request, ALLOWED_METHODS)
}

export async function GET(request: Request, context: RouteContext) {
	return proxyFieldRequest(request, context)
}

export async function POST(request: Request, context: RouteContext) {
	return proxyFieldRequest(request, context)
}

export async function PATCH(request: Request, context: RouteContext) {
	return proxyFieldRequest(request, context)
}

export async function PUT(request: Request, context: RouteContext) {
	return proxyFieldRequest(request, context)
}

export async function DELETE(request: Request, context: RouteContext) {
	return proxyFieldRequest(request, context)
}
