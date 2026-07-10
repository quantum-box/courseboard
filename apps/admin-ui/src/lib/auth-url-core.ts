const DEFAULT_AUTH_URL = 'https://courseboard.txcloud.app'
const TXCLOUD_HOST_SUFFIX = '.txcloud.app'
const WORKERS_DEV_HOST_SUFFIX = '.workers.dev'

function hostnameFromHost(host: string) {
	try {
		return new URL(`https://${host}`).hostname.toLowerCase()
	} catch {
		return host.toLowerCase()
	}
}

function isLocalhost(host: string) {
	const hostname = hostnameFromHost(host)
	return (
		hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
	)
}

function isTxcloudHost(host: string) {
	const hostname = hostnameFromHost(host)
	return hostname === 'txcloud.app' || hostname.endsWith(TXCLOUD_HOST_SUFFIX)
}

function isWorkersDevHost(host: string) {
	return hostnameFromHost(host).endsWith(WORKERS_DEV_HOST_SUFFIX)
}

export function canonicalizeAuthUrl(value: string): string {
	try {
		const url = new URL(value)
		if (isWorkersDevHost(url.hostname)) {
			return DEFAULT_AUTH_URL
		}
		return url.toString().replace(/\/+$/, '')
	} catch {
		return DEFAULT_AUTH_URL
	}
}

function normalizeAuthUrl(
	value: string | undefined | null,
): string | undefined {
	if (!value) return undefined
	try {
		const url = new URL(value)
		if (isWorkersDevHost(url.hostname)) return undefined
		if (isTxcloudHost(url.hostname)) {
			url.protocol = 'https:'
			url.pathname = ''
			url.search = ''
			url.hash = ''
			return url.toString().replace(/\/+$/, '')
		}
		if (isLocalhost(url.host)) {
			return url.toString().replace(/\/+$/, '')
		}
	} catch {}
	return undefined
}

function firstHeaderValue(value: string | null | undefined) {
	return value?.split(',')[0]?.trim() || undefined
}

function forwardedHeaderParam(value: string | null | undefined, key: string) {
	const firstValue = firstHeaderValue(value)
	if (!firstValue) return undefined

	const prefix = `${key.toLowerCase()}=`
	return firstValue
		.split(';')
		.map(part => part.trim())
		.find(part => part.toLowerCase().startsWith(prefix))
		?.slice(prefix.length)
		.replace(/^"|"$/g, '')
}

function normalizeHost(value: string | undefined) {
	if (!value) return undefined
	const host = value.trim().replace(/^"|"$/g, '')
	if (!host || host.includes('/') || host.includes('@')) return undefined
	return host
}

function normalizeProto(value: string | undefined) {
	const proto = value?.trim().replace(/^"|"$/g, '').replace(/:$/, '')
	if (proto === 'http' || proto === 'https') return proto
	return undefined
}

export function resolveAuthUrlFromRequest(input: {
	headers: Headers
	requestUrl: string
}): string | undefined {
	const forwarded = input.headers.get('forwarded')
	const host = normalizeHost(
		firstHeaderValue(input.headers.get('x-forwarded-host')) ??
			forwardedHeaderParam(forwarded, 'host') ??
			input.headers.get('host') ??
			undefined,
	)
	if (!host) return undefined
	if (isWorkersDevHost(host)) return undefined

	const requestUrl = new URL(input.requestUrl)
	const proto = isTxcloudHost(host)
		? 'https'
		: (normalizeProto(forwardedHeaderParam(forwarded, 'proto')) ??
			normalizeProto(
				firstHeaderValue(input.headers.get('x-forwarded-proto')),
			) ??
			normalizeProto(requestUrl.protocol) ??
			'https')

	if (!isTxcloudHost(host) && !isLocalhost(host)) return undefined

	return `${proto}://${host}`
}

export function resolveAuthUrlFromEnv(env: {
	cfPagesUrl?: string | null
	authUrl?: string | null
	nextAuthUrl?: string | null
}): string {
	return canonicalizeAuthUrl(
		normalizeAuthUrl(env.cfPagesUrl) ??
			normalizeAuthUrl(env.authUrl) ??
			normalizeAuthUrl(env.nextAuthUrl) ??
			DEFAULT_AUTH_URL,
	)
}
