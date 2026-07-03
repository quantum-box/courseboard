const DEFAULT_BACKEND_URL = 'http://0.0.0.0:50056'
const DEFAULT_BROWSER_BACKEND_URL = 'http://localhost:50056'
const DEFAULT_TACHYON_API_URL = 'http://0.0.0.0:50054'
const DEFAULT_TACHYON_FIELD_API_URL = 'http://tachyon-field-api:14001'

export const getBackendBaseUrl = () => {
	const fieldUrl = readEnv('TACHYON_FIELD_API_URL')
	const serverUrl = readEnv('BACKEND_API_URL')
	const publicUrl = readEnv('NEXT_PUBLIC_BACKEND_API_URL')

	if (typeof window === 'undefined') {
		return (
			fieldUrl ?? serverUrl ?? publicUrl ?? getLocalBackendUrlOrThrow('server')
		)
	}

	return normalizeBrowserBackendUrl(
		publicUrl ?? getLocalBrowserBackendUrlOrThrow(),
	)
}

export const getTachyonApiBaseUrl = () => {
	const serverUrl = process.env.TACHYON_API_URL
	const publicUrl = process.env.NEXT_PUBLIC_TACHYON_API_URL

	if (typeof window === 'undefined') {
		return serverUrl ?? publicUrl ?? DEFAULT_TACHYON_API_URL
	}

	return publicUrl ?? serverUrl ?? DEFAULT_TACHYON_API_URL
}

export const getTachyonFieldAdminBaseUrl = () => {
	const serverUrl =
		readEnv('TACHYON_FIELD_API_URL') ??
		readEnv('BACKEND_API_URL') ??
		readEnv('NEXT_PUBLIC_BACKEND_API_URL')

	return serverUrl ?? DEFAULT_TACHYON_FIELD_API_URL
}

function getLocalBackendUrlOrThrow(context: 'browser' | 'server') {
	if (isCloudRuntime() && !isNextBuildTime()) {
		throw new Error(
			`TACHYON Field ${context} backend URL is not configured in runtime env`,
		)
	}

	return DEFAULT_BACKEND_URL
}

function getLocalBrowserBackendUrlOrThrow() {
	if (isCloudRuntime() && !isNextBuildTime()) {
		throw new Error(
			'TACHYON Field browser backend URL is not configured in runtime env',
		)
	}

	return DEFAULT_BROWSER_BACKEND_URL
}

function normalizeBrowserBackendUrl(url: string) {
	if (!isLocalBrowserRuntime()) {
		return url
	}

	try {
		const parsed = new URL(url)
		if (
			parsed.hostname === 'tachyon-field-api' ||
			parsed.hostname === '0.0.0.0'
		) {
			parsed.hostname = window.location.hostname || 'localhost'
			return parsed.toString().replace(/\/$/, '')
		}
	} catch {
		return url
	}

	return url
}

function isLocalBrowserRuntime() {
	if (typeof window === 'undefined') {
		return false
	}

	const hostname = window.location.hostname
	return (
		hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
	)
}

function isCloudRuntime() {
	return (
		process.env.CF_PAGES === '1' ||
		process.env.TACHYON_DEPLOYMENT_TARGET === 'cloudflare_pages' ||
		process.env.TACHYON_DEPLOYMENT_TARGET === 'cloudflare_workers' ||
		process.env.DEPLOYMENT_TARGET === 'cloudflare_pages' ||
		process.env.DEPLOYMENT_TARGET === 'cloudflare_workers'
	)
}

function readEnv(name: string) {
	const value = readKnownEnv(name)?.trim()
	return value ? value : undefined
}

function readKnownEnv(name: string) {
	switch (name) {
		case 'TACHYON_FIELD_API_URL':
			return process.env.TACHYON_FIELD_API_URL
		case 'BACKEND_API_URL':
			return process.env.BACKEND_API_URL
		case 'NEXT_PUBLIC_BACKEND_API_URL':
			return process.env.NEXT_PUBLIC_BACKEND_API_URL
		default:
			return undefined
	}
}

function isNextBuildTime() {
	return process.env.NEXT_PHASE === 'phase-production-build'
}
