import {
	getAuthPkceDiagnostics,
	getAuthSecretFingerprintForRequest,
} from 'app/auth'
import {
	handleAuthCoreRequest,
	handleSigninProviderRequest,
} from './auth-route'

export const runtime = 'edge'

type InstrumentationState = {
	authJsErrorName?: string
	checkFailed?: 'pkce' | 'state' | 'nonce'
}

function getDiscriminatorLeg(request: Request) {
	const pathname = new URL(request.url).pathname
	if (pathname.startsWith('/api/auth/signin/')) return 'authorize'
	if (pathname.startsWith('/api/auth/callback/')) return 'callback'
	return undefined
}

async function applyDiscriminatorHeaders(
	request: Request,
	response: Response,
	state: InstrumentationState,
) {
	const leg = getDiscriminatorLeg(request)
	if (!leg) {
		return response
	}

	const headers = new Headers(response.headers)
	headers.set(
		'x-fa-secret-fp',
		await getAuthSecretFingerprintForRequest(request),
	)
	if (leg === 'callback') {
		const pkce = await getAuthPkceDiagnostics(request)
		headers.set('x-fa-pkce-present', String(pkce.present))
		headers.set('x-fa-pkce-decrypt', String(pkce.decrypt))
	}
	if (state.authJsErrorName) {
		headers.set('x-fa-authjs-error', state.authJsErrorName)
	}
	if (state.checkFailed) {
		headers.set('x-fa-check-failed', state.checkFailed)
	}

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	})
}

async function handleAuthRequest(request: Request) {
	const state: InstrumentationState = {}
	const instrumentation = {
		onCheckFailed(check: 'pkce' | 'state' | 'nonce') {
			state.checkFailed = check
		},
		onLoggerErrorName(name: string) {
			state.authJsErrorName = name
		},
	}

	const response =
		(await handleSigninProviderRequest(request, instrumentation)) ??
		(await handleAuthCoreRequest(request, instrumentation))

	return applyDiscriminatorHeaders(request, response, state)
}

async function handleAuthPostRequest(request: Request) {
	const state: InstrumentationState = {}
	const instrumentation = {
		onCheckFailed(check: 'pkce' | 'state' | 'nonce') {
			state.checkFailed = check
		},
		onLoggerErrorName(name: string) {
			state.authJsErrorName = name
		},
	}

	const response =
		(await handleSigninProviderRequest(request, instrumentation)) ??
		(await handleAuthCoreRequest(request, instrumentation))

	return applyDiscriminatorHeaders(request, response, state)
}

export const GET = handleAuthRequest

export const POST = handleAuthPostRequest
