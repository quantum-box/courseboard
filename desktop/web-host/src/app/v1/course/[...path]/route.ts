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
import {
	getServerCourseApiBaseUrl,
	joinServerCourseApiPath,
} from 'lib/serverCourseApiUrl'

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

function json(request: Request, body: unknown, init: ResponseInit = {}) {
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

export function isAllowedCourseRoute(method: string, path: string) {
	if (!hasSafeSegments(path)) return false
	if (!path.startsWith('/v1/course/')) return false
	const suffix = path.slice('/v1/course/'.length)
	if (!suffix) return false
	return (ALLOWED_METHODS as readonly string[]).includes(method.toUpperCase())
}

function normalizedCoursePath(pathSegments: string[] | undefined) {
	if (!pathSegments?.length) return undefined
	const path = `/v1/course/${pathSegments.join('/')}`
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

async function proxyCourseRequest(
	request: Request,
	{ params }: RouteContext,
) {
	const path = normalizedCoursePath(params.path)
	if (!path || !isAllowedCourseRoute(request.method, path)) {
		return proxyError(
			request,
			404,
			'COURSE_PATH_NOT_AVAILABLE',
			'Course API path is not available',
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

	if (!getServerCourseApiBaseUrl()) {
		return proxyError(
			request,
			503,
			'COURSE_API_URL_NOT_CONFIGURED',
			'COURSEBOARD_API_URL must point at CourseBoard course-api',
		)
	}

	const upstreamUrl = new URL(joinServerCourseApiPath(path))
	upstreamUrl.search = incomingUrl.search
	const headers = new Headers({
		accept: safePassthroughHeader(request, 'accept', 512) ?? 'application/json',
		authorization: `Bearer ${tenantResult.session.accessToken}`,
		'x-courseboard-authorization': `Bearer ${tenantResult.session.accessToken}`,
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
				'COURSE_API_OAUTH_INCOMPATIBLE',
				'Course API rejected a token already verified by Tachyon Auth',
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
			'COURSE_API_UNAVAILABLE',
			'Course API request failed',
		)
	} finally {
		clearTimeout(timeout)
	}
}

export async function OPTIONS(request: Request) {
	return nativeCorsPreflight(request, ALLOWED_METHODS)
}

export async function GET(request: Request, context: RouteContext) {
	return proxyCourseRequest(request, context)
}

export async function POST(request: Request, context: RouteContext) {
	return proxyCourseRequest(request, context)
}

export async function PATCH(request: Request, context: RouteContext) {
	return proxyCourseRequest(request, context)
}

export async function PUT(request: Request, context: RouteContext) {
	return proxyCourseRequest(request, context)
}

export async function DELETE(request: Request, context: RouteContext) {
	return proxyCourseRequest(request, context)
}
