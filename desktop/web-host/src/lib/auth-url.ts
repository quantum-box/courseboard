import { getRuntimeEnv } from './runtime-env'
export {
	resolveAuthUrlFromEnv,
	resolveAuthUrlFromRequest,
} from './auth-url-core'
import {
	canonicalizeAuthUrl,
	resolveAuthUrlFromEnv,
	resolveAuthUrlFromRequest,
} from './auth-url-core'

/**
 * Resolves the public auth base URL for NextAuth / Cognito callbacks.
 * Auth route requests prefer the forwarded request host so Cloudflare Workers
 * previews keep callback URLs on the same preview origin.
 */
export function resolveAuthUrl(request?: Request): string {
	const requestUrl = request
		? resolveAuthUrlFromRequest({
				headers: request.headers,
				requestUrl: request.url,
			})
		: undefined
	if (requestUrl) {
		return canonicalizeAuthUrl(requestUrl)
	}

	return canonicalizeAuthUrl(
		resolveAuthUrlFromEnv({
			cfPagesUrl: getRuntimeEnv('CF_PAGES_URL'),
			authUrl: getRuntimeEnv('AUTH_URL'),
			nextAuthUrl: getRuntimeEnv('NEXTAUTH_URL'),
		}),
	)
}
