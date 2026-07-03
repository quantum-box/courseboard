const SIGNIN_PROVIDER_PATH_PATTERN = /^\/api\/auth\/signin\/([^/]+)$/
const SIGNIN_ACTION_BODY_KEYS = new Set(['callbackUrl', 'csrfToken'])
const TXCLOUD_HOST_SUFFIX = '.txcloud.app'
const WORKERS_DEV_HOST_SUFFIX = '.workers.dev'

function isTxcloudHost(hostname: string) {
	return hostname === 'txcloud.app' || hostname.endsWith(TXCLOUD_HOST_SUFFIX)
}

function isWorkersDevHost(hostname: string) {
	return hostname.endsWith(WORKERS_DEV_HOST_SUFFIX)
}

export function getSigninProviderId(pathname: string) {
	const match = pathname.match(SIGNIN_PROVIDER_PATH_PATTERN)
	return match?.[1]
}

export function createAuthActionRequest(
	request: Request,
	options: {
		authUrl: string
		callbackUrl?: string
		searchParams?: URLSearchParams
	},
) {
	const authUrl = new URL(options.authUrl)
	const url = new URL(request.url)
	url.protocol = authUrl.protocol
	url.host = authUrl.host

	const headers = new Headers(request.headers)
	headers.set('content-type', 'application/x-www-form-urlencoded')
	headers.set('host', authUrl.host)
	headers.set('x-forwarded-host', authUrl.host)
	headers.set('x-forwarded-proto', authUrl.protocol.replace(/:$/, ''))

	return new Request(url, {
		body: new URLSearchParams({
			callbackUrl: options.callbackUrl ?? '/',
			...(options.searchParams
				? Object.fromEntries(options.searchParams.entries())
				: {}),
		}),
		headers,
		method: 'POST',
	})
}

export function normalizeAuthCallbackUrl(value: string | undefined | null) {
	if (!value) return '/'
	if (value.startsWith('/')) return value

	try {
		const url = new URL(value)
		if (isWorkersDevHost(url.hostname)) return '/'
		if (isTxcloudHost(url.hostname)) {
			return `${url.pathname}${url.search}${url.hash}` || '/'
		}
	} catch {}

	return '/'
}

export function createCanonicalAuthRequest(
	request: Request,
	options: { authUrl: string },
) {
	const authUrl = new URL(options.authUrl)
	const url = new URL(request.url)
	url.protocol = authUrl.protocol
	url.host = authUrl.host

	const headers = new Headers(request.headers)
	headers.set('host', authUrl.host)
	headers.set('x-forwarded-host', authUrl.host)
	headers.set('x-forwarded-proto', authUrl.protocol.replace(/:$/, ''))

	const method = request.method.toUpperCase()
	const init: RequestInit = {
		headers,
		method: request.method,
	}
	if (method !== 'GET' && method !== 'HEAD') {
		init.body = request.body
	}

	return new Request(url, init)
}

export async function resolveSigninProviderActionOptions(request: Request) {
	const url = new URL(request.url)
	const providerId = getSigninProviderId(url.pathname)
	if (!providerId) {
		return undefined
	}

	let callbackUrl = normalizeAuthCallbackUrl(
		url.searchParams.get('callbackUrl'),
	)
	const authorizationParams = new URLSearchParams(url.searchParams)
	authorizationParams.delete('callbackUrl')

	if (request.method.toUpperCase() === 'POST') {
		const contentType = request.headers.get('content-type') ?? ''
		if (contentType.includes('application/x-www-form-urlencoded')) {
			const body = await request.clone().formData()
			body.forEach((value, key) => {
				if (typeof value !== 'string') {
					return
				}
				if (key === 'callbackUrl') {
					callbackUrl = normalizeAuthCallbackUrl(value)
					return
				}
				if (!SIGNIN_ACTION_BODY_KEYS.has(key)) {
					authorizationParams.set(key, value)
				}
			})
		}
	}

	return {
		callbackUrl,
		searchParams: authorizationParams,
	}
}
