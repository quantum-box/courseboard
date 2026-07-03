import {
	auth,
	refreshAuthSession,
	verifyAccessToken,
} from 'app/auth'
import { NextResponse } from 'next/server'

type TokenRequest = {
	force?: unknown
}

function unauthorized() {
	return NextResponse.json(
		{ code: 'UNAUTHORIZED', message: 'Unable to refresh access token' },
		{ status: 401 },
	)
}

export async function POST(request: Request) {
	let body: TokenRequest = {}
	try {
		body = (await request.json()) as TokenRequest
	} catch {
		body = {}
	}

	const session =
		body.force === true ? await refreshAuthSession() : await auth()
	if (
		!session?.accessToken ||
		session.error === 'RefreshAccessTokenError' ||
		session.error === 'VerifyAccessTokenError'
	) {
		return unauthorized()
	}

	try {
		await verifyAccessToken(session.accessToken)
	} catch {
		return unauthorized()
	}

	return NextResponse.json({ accessToken: session.accessToken })
}
