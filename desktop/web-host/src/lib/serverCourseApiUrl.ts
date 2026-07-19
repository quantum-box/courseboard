import { getRuntimeEnv } from './runtime-env'

const DEFAULT_LOCAL_COURSE_API_URL = 'http://127.0.0.1:8080'

function isCloudflareWorkerRuntime() {
	const deploymentTarget =
		getRuntimeEnv('TACHYON_DEPLOYMENT_TARGET') ??
		getRuntimeEnv('DEPLOYMENT_TARGET') ??
		''
	return (
		deploymentTarget.includes('cloudflare') ||
		getRuntimeEnv('CF_PAGES') === '1' ||
		getRuntimeEnv('VERCEL') === '1'
	)
}

/**
 * Upstream CourseBoard Rust course-api base URL.
 *
 * Distinct from Field (`TACHYON_FIELD_API_URL`). Local Vite / Auth.js BFF
 * flows proxy `/v1/course/*` here so web-host never composes Field golf
 * catalog paths itself.
 *
 * Production Cloudflare Workers must set `COURSEBOARD_API_URL` — the local
 * loopback default is only for Auth.js/Vite development.
 */
export function getServerCourseApiBaseUrl(): string | undefined {
	const configured =
		getRuntimeEnv('COURSEBOARD_API_URL') ??
		getRuntimeEnv('COURSEBOARD_RUST_API_URL')
	if (configured?.trim()) {
		return configured.replace(/\/+$/, '')
	}
	if (isCloudflareWorkerRuntime()) {
		return undefined
	}
	return DEFAULT_LOCAL_COURSE_API_URL
}

export function joinServerCourseApiPath(path: string) {
	const baseUrl = getServerCourseApiBaseUrl()
	if (!baseUrl) {
		throw new Error('COURSEBOARD_API_URL is not configured')
	}
	const normalizedPath = `/${path.replace(/^\/+/, '')}`
	return `${baseUrl}${normalizedPath}`
}
