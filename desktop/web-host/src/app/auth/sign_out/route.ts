import { AUTH_SESSION_COOKIE_NAMES, resolveAuthUrl } from 'app/auth'
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

function signOut(request: Request) {
	const requestUrl = new URL(request.url)
	const redirectUrl = new URL(
		'/auth/sign_in',
		canonicalizeAuthUrl(resolveAuthUrl(request)),
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
