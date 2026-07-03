import type { CloudAppExtension } from './cloud-app-extension-registry'

export const EXTENSION_PROXY_TIMEOUT_MS = 10_000

const ALLOWED_EXTENSION_PROXY_METHODS = new Set([
	'GET',
	'POST',
	'PUT',
	'PATCH',
	'DELETE',
])

const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'content-length',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'host',
])

const RESPONSE_BLOCKED_HEADERS = new Set([
	'content-encoding',
	'set-cookie',
	'set-cookie2',
])

export type ExtensionProxyUrlResult =
	| { ok: true; url: URL }
	| { ok: false; reason: string }

export function isAllowedExtensionProxyMethod(method: string) {
	return ALLOWED_EXTENSION_PROXY_METHODS.has(method.toUpperCase())
}

export function buildExtensionProxyUrl(
	extension: CloudAppExtension,
	pathSegments: string[],
	search: string,
): ExtensionProxyUrlResult {
	let baseUrl: URL
	try {
		baseUrl = new URL(extension.apiBaseUrl)
	} catch {
		return { ok: false, reason: 'extension api base url is invalid' }
	}

	if (!isAllowedExtensionApiBaseUrl(baseUrl)) {
		return { ok: false, reason: 'extension api base url is not allowed' }
	}

	if (baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) {
		return { ok: false, reason: 'extension api base url must be canonical' }
	}

	const basePath = baseUrl.pathname.replace(/\/+$/, '')
	const safePath = pathSegments
		.map(segment => encodeURIComponent(segment))
		.join('/')
	const url = new URL(baseUrl.toString())
	url.pathname = safePath ? `${basePath}/${safePath}` : basePath || '/'
	url.search = search.startsWith('?') ? search.slice(1) : search
	return { ok: true, url }
}

export function buildExtensionProxyHeaders(
	requestHeaders: Headers,
	accessToken: string,
) {
	const headers = new Headers()
	const connectionHeaders = parseConnectionHeader(requestHeaders)
	requestHeaders.forEach((value, key) => {
		const normalizedKey = key.toLowerCase()
		if (
			HOP_BY_HOP_HEADERS.has(normalizedKey) ||
			connectionHeaders.has(normalizedKey)
		) {
			return
		}
		if (normalizedKey === 'authorization') {
			return
		}
		headers.set(key, value)
	})
	headers.set('Authorization', `Bearer ${accessToken}`)
	return headers
}

export function buildExtensionProxyFetchInit({
	method,
	requestHeaders,
	accessToken,
	body,
}: {
	method: string
	requestHeaders: Headers
	accessToken: string
	body?: BodyInit | null
}): RequestInit {
	const normalizedMethod = method.toUpperCase()
	return {
		method: normalizedMethod,
		headers: buildExtensionProxyHeaders(requestHeaders, accessToken),
		body: ['GET', 'HEAD'].includes(normalizedMethod) ? undefined : body,
		redirect: 'manual',
		signal: timeoutSignal(EXTENSION_PROXY_TIMEOUT_MS),
	}
}

export function filterExtensionProxyResponseHeaders(headers: Headers) {
	const nextHeaders = new Headers()
	headers.forEach((value, key) => {
		const normalizedKey = key.toLowerCase()
		if (
			HOP_BY_HOP_HEADERS.has(normalizedKey) ||
			RESPONSE_BLOCKED_HEADERS.has(normalizedKey)
		) {
			return
		}
		nextHeaders.set(key, value)
	})
	return nextHeaders
}

export function isExtensionProxyRedirectStatus(status: number) {
	return status >= 300 && status < 400
}

export function isExtensionProxyTimeout(error: unknown) {
	if (!(error instanceof Error)) {
		return false
	}
	return error.name === 'AbortError' || error.name === 'TimeoutError'
}

function parseConnectionHeader(headers: Headers) {
	const connectionHeaders = new Set<string>()
	const connection = headers.get('Connection')
	if (!connection) {
		return connectionHeaders
	}
	for (const item of connection.split(',')) {
		const normalized = item.trim().toLowerCase()
		if (normalized) {
			connectionHeaders.add(normalized)
		}
	}
	return connectionHeaders
}

function isAllowedExtensionApiBaseUrl(url: URL) {
	if (url.protocol === 'https:') {
		return true
	}
	if (url.protocol !== 'http:') {
		return false
	}
	return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
}

function timeoutSignal(timeoutMs: number) {
	if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
		return AbortSignal.timeout(timeoutMs)
	}

	const controller = new AbortController()
	setTimeout(() => controller.abort(), timeoutMs)
	return controller.signal
}
