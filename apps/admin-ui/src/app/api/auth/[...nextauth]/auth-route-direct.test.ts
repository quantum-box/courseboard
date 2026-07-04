import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	createAuthConfig: vi.fn(),
	resolveAuthUrl: vi.fn(),
}))

vi.mock('@auth/core', () => ({
	Auth: mocks.auth,
	skipCSRFCheck: Symbol.for('skip-csrf-check'),
}))

vi.mock('app/auth', () => ({
	createAuthConfig: mocks.createAuthConfig,
	resolveAuthUrl: mocks.resolveAuthUrl,
}))

import {
	handleAuthCoreRequest,
	handleSigninProviderRequest,
} from './auth-route'

describe('courseboard Auth.js direct route adapter', () => {
	beforeEach(() => {
		mocks.auth.mockReset()
		mocks.createAuthConfig.mockReset()
		mocks.resolveAuthUrl.mockReset()
		mocks.auth.mockResolvedValue(new Response(null, { status: 204 }))
		mocks.createAuthConfig.mockReturnValue({
			basePath: '/api/auth',
			providers: [],
			secret: 'test-secret',
		})
		mocks.resolveAuthUrl.mockImplementation((request?: Request) => {
			if (!request) return 'https://courseboard.txcloud.app'
			const forwardedHost = request.headers.get('x-forwarded-host')
			if (forwardedHost?.endsWith('.txcloud.app')) {
				return `https://${forwardedHost}`
			}
			const url = new URL(request.url)
			if (url.hostname.endsWith('.workers.dev')) {
				return 'https://courseboard.txcloud.app'
			}
			return url.origin
		})
	})

	it('canonicalizes callback requests before passing them to Auth core', async () => {
		const request = new Request(
			'https://courseboard.quantum-box.workers.dev/api/auth/callback/cognito?code=present',
			{
				headers: {
					host: 'courseboard.quantum-box.workers.dev',
					cookie: '__Secure-authjs.pkce.code_verifier=value-length-only',
				},
			},
		)
		const instrumentation = {}

		await handleAuthCoreRequest(request, instrumentation)

		const authRequest = mocks.auth.mock.calls[0]?.[0] as Request
		expect(mocks.createAuthConfig).toHaveBeenCalledWith(instrumentation, {
			authUrl: 'https://courseboard.txcloud.app',
		})
		expect(mocks.auth).toHaveBeenCalledWith(
			authRequest,
			expect.objectContaining({ basePath: '/api/auth' }),
		)
		expect(authRequest.url).toBe(
			'https://courseboard.txcloud.app/api/auth/callback/cognito?code=present',
		)
		expect(authRequest.headers.get('host')).toBe('courseboard.txcloud.app')
		expect(authRequest.headers.get('x-forwarded-host')).toBe(
			'courseboard.txcloud.app',
		)
		expect(authRequest.headers.get('cookie')).toBe(
			'__Secure-authjs.pkce.code_verifier=value-length-only',
		)
	})

	it('still normalizes provider sign-in requests before calling Auth core', async () => {
		const request = new Request(
			'https://courseboard.quantum-box.workers.dev/api/auth/signin/cognito?identity_provider=Google',
			{
				headers: {
					'x-forwarded-host': 'pr357--courseboard.txcloud.app',
					'x-forwarded-proto': 'https',
				},
				method: 'GET',
			},
		)

		await handleSigninProviderRequest(request)

		const authRequest = mocks.auth.mock.calls[0]?.[0] as Request
		const authConfig = mocks.auth.mock.calls[0]?.[1] as Record<string, unknown>
		expect(authRequest).toBeInstanceOf(Request)
		expect(authRequest.method).toBe('POST')
		expect(authRequest.url).toBe(
			'https://pr357--courseboard.txcloud.app/api/auth/signin/cognito?identity_provider=Google',
		)
		expect(authConfig.skipCSRFCheck).toBe(Symbol.for('skip-csrf-check'))
	})
})
