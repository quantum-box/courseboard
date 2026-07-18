import {
	AUTH_SESSION_COOKIE_NAMES,
	AUTH_SIGN_IN_PATH,
	resolveAuthUrl,
} from 'app/auth'
import { canonicalizeAuthUrl } from 'lib/auth-url-core'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

function expireAuthSessionCookies(response: NextResponse, requestUrl: URL) {
	const isSecureRequest = requestUrl.protocol === 'https:'
	for (const name of AUTH_SESSION_COOKIE_NAMES) {
		response.cookies.set(name, '', {
			expires: new Date(0),
			httpOnly: true,
			maxAge: 0,
			path: '/',
			sameSite: 'lax',
			secure: isSecureRequest || name.startsWith('__Secure-'),
		})
	}
}

function publicRequestOrigin(request: Request, requestUrl: URL) {
	const forwardedHost = request.headers.get('x-forwarded-host')
	if (!forwardedHost) return requestUrl.origin
	const forwardedProto = request.headers
		.get('x-forwarded-proto')
		?.split(',', 1)[0]
		?.trim()
	const protocol =
		forwardedProto === 'http' || forwardedProto === 'https'
			? forwardedProto
			: requestUrl.protocol.slice(0, -1)
	return `${protocol}://${forwardedHost}`
}

function signOut(request: Request) {
	const requestUrl = new URL(request.url)
	const authOrigin = new URL(
		canonicalizeAuthUrl(resolveAuthUrl(request)),
	).origin
	const requestOrigin = publicRequestOrigin(request, requestUrl)
	const redirectUrl = new URL(
		requestOrigin === authOrigin ? AUTH_SIGN_IN_PATH : '/auth/sign_out',
		authOrigin,
	)
	if (requestUrl.searchParams.get('error') === 'expired') {
		redirectUrl.searchParams.set('error', 'expired')
	}

	const response = NextResponse.redirect(redirectUrl, 303)
	expireAuthSessionCookies(response, requestUrl)
	return response
}

export function GET(request: Request) {
	return signOut(request)
}

export function POST(request: Request) {
	return signOut(request)
}
