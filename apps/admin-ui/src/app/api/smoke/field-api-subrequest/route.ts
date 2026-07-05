import { joinServerBackendPath } from 'lib/serverBackendUrl'

export const runtime = 'edge'

const FIELD_API_HEALTH_PATH = '/health'
const SUBREQUEST_TIMEOUT_MS = 30_000

export async function GET() {
	const startedAt = Date.now()
	const backendUrl = new URL(joinServerBackendPath(FIELD_API_HEALTH_PATH))
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), SUBREQUEST_TIMEOUT_MS)

	try {
		const response = await fetch(backendUrl, {
			headers: {
				Accept: 'text/plain',
				'User-Agent': 'courseboard-field-api-subrequest-smoke',
			},
			signal: controller.signal,
		})
		const body = await response.text()
		const durationMs = Date.now() - startedAt
		const ok = response.status === 200 && body.trim() === 'OK'

		return Response.json(
			{
				ok,
				check: 'courseboard_field_api_subrequest',
				upstream: {
					origin: backendUrl.origin,
					path: backendUrl.pathname,
					status: response.status,
				},
				durationMs,
			},
			{ status: ok ? 200 : 502 },
		)
	} catch (error) {
		const durationMs = Date.now() - startedAt
		const errorName = error instanceof Error ? error.name : 'Error'

		return Response.json(
			{
				ok: false,
				check: 'courseboard_field_api_subrequest',
				upstream: {
					origin: backendUrl.origin,
					path: backendUrl.pathname,
					status: null,
				},
				durationMs,
				error: errorName,
			},
			{ status: 502 },
		)
	} finally {
		clearTimeout(timeout)
	}
}
