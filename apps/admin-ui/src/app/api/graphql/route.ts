import { auth } from 'app/auth'
import { GRAPHQL_JSON_ACCEPT } from 'lib/browserGraphqlProxy'
import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

/**
 * Same-origin GraphQL proxy for browser urql traffic (PLT-2501).
 *
 * Browser mutations/queries used to POST directly to the public Field API URL
 * (`NEXT_PUBLIC_BACKEND_API_URL`). That path fails deterministically: urql
 * advertises `Accept: … text/event-stream …` and the public txcloud edge in
 * front of the Lambda-backed Field API answers
 * `501 Origin does not support SSE` without CORS headers, which the browser
 * surfaces as `[Network] Failed to fetch`. This route forwards the request
 * over the server-side internalService URL instead — the same stable path SSR
 * reads use (#36) — with a JSON-only Accept and a server-derived bearer token.
 */

const UPSTREAM_TIMEOUT_MS = 30_000

/** Tenant scoping headers the client is allowed to pass through. */
const FORWARDED_TENANT_HEADERS = ['x-operator-id', 'x-platform-id'] as const

/** Tenant ids / operator slugs only — no control characters or separators. */
const TENANT_HEADER_VALUE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

function unauthorized() {
	return NextResponse.json(
		{ errors: [{ message: 'UNAUTHORIZED' }] },
		{ status: 401 },
	)
}

export async function POST(request: Request) {
	const session = await auth()
	if (
		!session?.accessToken ||
		session.error === 'RefreshAccessTokenError' ||
		session.error === 'VerifyAccessTokenError'
	) {
		return unauthorized()
	}

	const headers: Record<string, string> = {
		'content-type': 'application/json',
		accept: GRAPHQL_JSON_ACCEPT,
		// Server-derived token (kept fresh by the auth session), never the
		// client-supplied Authorization header.
		authorization: `Bearer ${session.accessToken}`,
	}
	for (const name of FORWARDED_TENANT_HEADERS) {
		const value = request.headers.get(name)
		if (value === null) {
			continue
		}
		if (!TENANT_HEADER_VALUE_PATTERN.test(value)) {
			return NextResponse.json(
				{ errors: [{ message: `Invalid ${name} header` }] },
				{ status: 400 },
			)
		}
		headers[name] = value
	}

	const body = await request.text()

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
	try {
		const upstream = await fetch(joinServerBackendPath('/v1/graphql'), {
			method: 'POST',
			headers,
			body,
			signal: controller.signal,
		})
		const text = await upstream.text()
		return new NextResponse(text, {
			status: upstream.status,
			headers: {
				'content-type':
					upstream.headers.get('content-type') ?? 'application/json',
			},
		})
	} catch (error) {
		const errorName = error instanceof Error ? error.name : 'Error'
		return NextResponse.json(
			{
				errors: [
					{
						message: `Failed to reach TACHYON Field API (${errorName})`,
					},
				],
			},
			{ status: 502 },
		)
	} finally {
		clearTimeout(timeout)
	}
}
