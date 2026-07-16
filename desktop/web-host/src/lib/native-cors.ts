import { getRuntimeEnv } from './runtime-env'

const BUILT_IN_TAURI_ORIGINS = new Set([
	'tauri://localhost',
	'http://tauri.localhost',
	'https://tauri.localhost',
])

const ALLOWED_REQUEST_HEADERS = new Set([
	'accept',
	'authorization',
	'content-type',
	'idempotency-key',
	'if-match',
	'x-operator-id',
	'x-platform-id',
])

function configuredNativeOrigins() {
	return (getRuntimeEnv('COURSEBOARD_NATIVE_ALLOWED_ORIGINS') ?? '')
		.split(',')
		.map(origin => origin.trim())
		.filter(origin => {
			if (!origin) return false
			try {
				const url = new URL(origin)
				return (
					url.protocol === 'https:' &&
					!url.username &&
					!url.password &&
					url.pathname === '/' &&
					!url.search &&
					!url.hash &&
					url.origin === origin
				)
			} catch {
				return false
			}
		})
}

export function isAllowedNativeOrigin(origin: string) {
	return (
		BUILT_IN_TAURI_ORIGINS.has(origin) ||
		configuredNativeOrigins().includes(origin)
	)
}

export function isRejectedCrossOrigin(request: Request) {
	const origin = request.headers.get('origin')
	if (!origin) return false
	return origin !== new URL(request.url).origin && !isAllowedNativeOrigin(origin)
}

export function applyNativeCors(request: Request, response: Response) {
	const origin = request.headers.get('origin')
	if (!origin || !isAllowedNativeOrigin(origin)) return response

	const headers = new Headers(response.headers)
	headers.set('access-control-allow-origin', origin)
	headers.set(
		'access-control-expose-headers',
		'Content-Disposition, ETag, X-Courseboard-Auth-Denial',
	)
	headers.append('vary', 'Origin')
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

export function nativeCorsPreflight(
	request: Request,
	allowedMethods: readonly string[],
) {
	const origin = request.headers.get('origin')
	if (!origin || !isAllowedNativeOrigin(origin)) {
		return Response.json(
			{ code: 'FORBIDDEN_ORIGIN', message: 'Origin is not allowed' },
			{ status: 403 },
		)
	}

	const requestedMethod = request.headers
		.get('access-control-request-method')
		?.toUpperCase()
	if (!requestedMethod || !allowedMethods.includes(requestedMethod)) {
		return Response.json(
			{ code: 'METHOD_NOT_ALLOWED', message: 'Method is not allowed' },
			{ status: 405 },
		)
	}

	const requestedHeaders = (
		request.headers.get('access-control-request-headers') ?? ''
	)
		.split(',')
		.map(header => header.trim().toLowerCase())
		.filter(Boolean)
	if (requestedHeaders.some(header => !ALLOWED_REQUEST_HEADERS.has(header))) {
		return Response.json(
			{ code: 'FORBIDDEN_HEADER', message: 'Header is not allowed' },
			{ status: 403 },
		)
	}

	const headers = new Headers({
		'access-control-allow-origin': origin,
		'access-control-allow-methods': allowedMethods.join(', '),
		'access-control-allow-headers': requestedHeaders.join(', '),
		'access-control-max-age': '600',
		vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
	})
	return new Response(null, { status: 204, headers })
}
