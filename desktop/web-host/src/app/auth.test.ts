import type { JWT } from 'next-auth/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-auth', () => ({
	default: () => ({
		auth: vi.fn(),
		handlers: { GET: vi.fn(), POST: vi.fn() },
		signIn: vi.fn(),
		signOut: vi.fn(),
	}),
}))

vi.mock('next-auth/jwt', () => ({
	decode: vi.fn(),
	encode: vi.fn(),
}))

vi.mock('next-auth/providers/cognito', () => ({
	default: (options: Record<string, unknown>) => ({
		id: 'cognito',
		name: 'Cognito',
		type: 'oidc',
		options,
	}),
}))

vi.mock('next/headers', () => ({
	cookies: vi.fn(),
}))

vi.mock('next/navigation', () => ({
	redirect: vi.fn(),
}))

vi.mock('./cognito', () => ({
	cognitoRefreshAccessToken: vi.fn(),
}))

import {
	AUTHJS_PKCE_COOKIE_NAME,
	clearAuthSessionCookies,
	createAuthConfig,
	getAuthPkceDiagnostics,
	getAuthSecretFingerprint,
	PASSWORD_SESSION_COOKIE_NAME,
	refreshAuthSession,
	verifyAccessToken,
} from './auth'
import { resolveAccountExpiresAt } from './auth-token'
import { isAdminRole, resolveJwtUser } from './auth-user'
import { cognitoRefreshAccessToken } from './cognito'
import { cookies } from 'next/headers'
import { decode, encode } from 'next-auth/jwt'

afterEach(() => {
	vi.clearAllMocks()
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe('isAdminRole', () => {
	it('allows OWNER and field:admin roles', () => {
		expect(isAdminRole('OWNER')).toBe(true)
		expect(isAdminRole('field:admin')).toBe(true)
		expect(isAdminRole('erp:admin')).toBe(true)
		expect(isAdminRole('GENERAL')).toBe(false)
	})
})

describe('resolveJwtUser', () => {
	it('uses verified user role and id when token verification succeeds', () => {
		const user = resolveJwtUser({
			token: { email: 'operator@example.com', user: {} } as JWT,
			profile: {
				sub: 'cognito-sub',
				'cognito:username': 'operator',
			},
			verifiedUser: {
				id: 'us_verified',
				role: 'OWNER',
				tenants: ['tn_allowed'],
			},
		})

		expect(user).toMatchObject({
			email: 'operator@example.com',
			id: 'us_verified',
			role: 'OWNER',
			tenants: ['tn_allowed'],
			username: 'operator',
		})
	})

	it('keeps tenant ids from an existing token when token verification is unavailable', () => {
		const user = resolveJwtUser({
			token: {
				user: {
					tenants: ['tn_cached'],
				},
			} as JWT,
			profile: {
				email: 'operator@example.com',
				sub: 'cognito-sub',
				'cognito:username': 'operator',
			},
		})

		expect(user).toMatchObject({
			email: 'operator@example.com',
			id: 'cognito-sub',
			role: 'GENERAL',
			tenants: ['tn_cached'],
			username: 'operator',
		})
	})

	it('falls back to safe profile claims when token verification is unavailable', () => {
		const user = resolveJwtUser({
			token: { user: {} } as JWT,
			profile: {
				email: 'operator@example.com',
				sub: 'cognito-sub',
				'cognito:username': 'operator',
			},
		})

		expect(user).toMatchObject({
			email: 'operator@example.com',
			id: 'cognito-sub',
			role: 'GENERAL',
			username: 'operator',
		})
	})
})

describe('resolveAccountExpiresAt', () => {
	it('uses OAuth expires_at from Auth.js when available', () => {
		const expiresAt = Math.floor(Date.now() / 1000 + 3600)
		expect(resolveAccountExpiresAt({ expires_at: expiresAt })).toBe(expiresAt)
	})

	it('falls back to OAuth expires_in and a default max age', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-07T08:00:00Z'))

		expect(resolveAccountExpiresAt({ expires_in: 1800 })).toBe(1780821000)
		expect(resolveAccountExpiresAt({})).toBe(1780822800)

		vi.useRealTimers()
	})
})

describe('createAuthConfig', () => {
	it('pins the Auth.js PKCE cookie name used as the JWE salt', () => {
		vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
		vi.stubEnv('COGNITO_CLIENT_ID', 'test-client-id')
		vi.stubEnv('COGNITO_CLIENT_SECRET', 'test-client-secret')
		vi.stubEnv(
			'COGNITO_ISSUER',
			'https://cognito-idp.ap-northeast-1.amazonaws.com/test_pool',
		)

		const config = createAuthConfig()

		expect(config.cookies?.pkceCodeVerifier?.name).toBe(AUTHJS_PKCE_COOKIE_NAME)
		expect(config.cookies?.pkceCodeVerifier?.options).toMatchObject({
			httpOnly: true,
			maxAge: 60 * 15,
			path: '/',
			sameSite: 'lax',
			secure: true,
		})
	})

	it('surfaces only Auth.js error type names to instrumentation', () => {
		vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
		vi.stubEnv('COGNITO_CLIENT_ID', 'test-client-id')
		vi.stubEnv('COGNITO_CLIENT_SECRET', 'test-client-secret')
		vi.stubEnv(
			'COGNITO_ISSUER',
			'https://cognito-idp.ap-northeast-1.amazonaws.com/test_pool',
		)

		const seenNames: string[] = []
		const config = createAuthConfig({
			onLoggerErrorName(name) {
				seenNames.push(name)
			},
		})

		const error = new Error('message must not be surfaced')
		Object.assign(error, { type: 'CallbackRouteError' })
		config.logger?.error?.(error)

		expect(seenNames).toEqual(['CallbackRouteError'])
	})

	it('surfaces only InvalidCheck check enums to instrumentation', () => {
		vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
		vi.stubEnv('COGNITO_CLIENT_ID', 'test-client-id')
		vi.stubEnv('COGNITO_CLIENT_SECRET', 'test-client-secret')
		vi.stubEnv(
			'COGNITO_ISSUER',
			'https://cognito-idp.ap-northeast-1.amazonaws.com/test_pool',
		)

		const seenChecks: string[] = []
		const config = createAuthConfig({
			onCheckFailed(check) {
				seenChecks.push(check)
			},
		})

		const error = new Error('pkce value could not be parsed')
		Object.assign(error, { type: 'InvalidCheck' })
		config.logger?.error?.(error)

		expect(seenChecks).toEqual(['pkce'])
	})

	it('can derive preview fallback secret from the request auth URL when CF_PAGES_URL is unset', () => {
		vi.stubEnv('COGNITO_CLIENT_ID', 'test-client-id')
		vi.stubEnv('COGNITO_CLIENT_SECRET', 'test-client-secret')
		vi.stubEnv(
			'COGNITO_ISSUER',
			'https://cognito-idp.ap-northeast-1.amazonaws.com/test_pool',
		)

		const config = createAuthConfig(
			{},
			{
				authUrl: 'https://pr357--courseboard.txcloud.app',
			},
		)

		expect(config.secret).toBe(
			'courseboard-preview-auth-secret:https://pr357--courseboard.txcloud.app',
		)
	})
})

describe('getAuthSecretFingerprint', () => {
	it('returns a 12-character sha256 fingerprint of the resolved secret', async () => {
		vi.stubEnv('AUTH_SECRET', 'test-auth-secret')

		await expect(getAuthSecretFingerprint()).resolves.toMatch(/^[0-9a-f]{12}$/)
	})
})

describe('verifyAccessToken', () => {
	it('validates bearer tokens through the current Tachyon profile endpoint', async () => {
		vi.stubEnv('TACHYON_API_URL', 'https://auth.example.test/')
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				user: {
					id: 'us_native',
					username: 'operator',
					role: 'GENERAL',
				},
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		await expect(verifyAccessToken('native.jwt.token')).resolves.toEqual({
			user: {
				id: 'us_native',
				username: 'operator',
				role: 'GENERAL',
			},
		})
		expect(fetchMock).toHaveBeenCalledWith(
			'https://auth.example.test/v1/me',
			{
				cache: 'no-store',
				headers: {
					accept: 'application/json',
					authorization: 'Bearer native.jwt.token',
				},
			},
		)
	})

	it('rejects bearer tokens refused by the profile endpoint', async () => {
		vi.stubEnv('TACHYON_API_URL', 'https://auth.example.test')
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
		)

		await expect(verifyAccessToken('expired.jwt.token')).rejects.toThrow(
			'Failed to verify access token: 401',
		)
	})
})

describe('clearAuthSessionCookies', () => {
	it('clears password-session chunks and Auth.js session cookies', () => {
		const deleteCookie = vi.fn()
		vi.mocked(cookies).mockReturnValue({
			delete: deleteCookie,
		} as never)

		clearAuthSessionCookies()

		expect(deleteCookie).toHaveBeenCalledWith(PASSWORD_SESSION_COOKIE_NAME)
		expect(deleteCookie).toHaveBeenCalledWith(
			`${PASSWORD_SESSION_COOKIE_NAME}.1`,
		)
		expect(deleteCookie).toHaveBeenCalledWith(
			`${PASSWORD_SESSION_COOKIE_NAME}.11`,
		)
		expect(deleteCookie).toHaveBeenCalledWith('authjs.session-token')
		expect(deleteCookie).toHaveBeenCalledWith('authjs.session-token.0')
		expect(deleteCookie).toHaveBeenCalledWith('authjs.session-token.11')
		expect(deleteCookie).toHaveBeenCalledWith('__Secure-authjs.session-token')
		expect(deleteCookie).toHaveBeenCalledWith('__Secure-authjs.session-token.0')
		expect(deleteCookie).toHaveBeenCalledWith('next-auth.session-token')
		expect(deleteCookie).toHaveBeenCalledWith(
			'__Secure-next-auth.session-token',
		)
		expect(deleteCookie).toHaveBeenCalledWith(
			'__Secure-next-auth.session-token.11',
		)
		expect(deleteCookie).toHaveBeenCalledWith(AUTHJS_PKCE_COOKIE_NAME)
		expect(deleteCookie).toHaveBeenCalledTimes(65)
	})
})

describe('refreshAuthSession', () => {
	it('refreshes Auth.js sessions stored in chunked cookies', async () => {
		vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
		vi.stubEnv('AUTH_URL', 'https://courseboard.txcloud.app')

		const getCookie = vi.fn((name: string) => {
			const values: Record<string, string> = {
				'authjs.session-token.0': 'chunk-a',
				'authjs.session-token.1': 'chunk-b',
			}
			const value = values[name]
			return value ? { value } : undefined
		})
		const deleteCookie = vi.fn()
		const setCookie = vi.fn()
		vi.mocked(cookies).mockReturnValue({
			delete: deleteCookie,
			get: getCookie,
			set: setCookie,
		} as never)

		const token = {
			accessToken: 'old-access-token',
			expires_at: 0,
			refreshToken: 'refresh-token',
			user: {
				email: 'operator@example.com',
				id: 'user_1',
				role: 'OWNER',
				username: 'operator',
			},
		} as JWT
		const refreshedToken = {
			...token,
			accessToken: 'new-access-token',
			expires_at: 1780822800,
		} as JWT
		vi.mocked(decode).mockResolvedValue(token)
		vi.mocked(encode).mockResolvedValue('encoded-refreshed-session')
		vi.mocked(cognitoRefreshAccessToken).mockResolvedValue(refreshedToken)

		const session = await refreshAuthSession()

		expect(decode).toHaveBeenCalledWith(
			expect.objectContaining({
				salt: 'authjs.session-token',
				secret: 'test-auth-secret',
				token: 'chunk-achunk-b',
			}),
		)
		expect(cognitoRefreshAccessToken).toHaveBeenCalledWith(token)
		expect(deleteCookie).toHaveBeenCalledWith('authjs.session-token.0')
		expect(setCookie).toHaveBeenCalledWith(
			PASSWORD_SESSION_COOKIE_NAME,
			'encoded-refreshed-session',
			expect.objectContaining({
				httpOnly: true,
				sameSite: 'lax',
				secure: true,
			}),
		)
		expect(session).toMatchObject({
			accessToken: 'new-access-token',
			user: {
				id: 'user_1',
				role: 'OWNER',
			},
		})
	})

	it('clears stale cookies when an Auth.js refresh cannot be persisted', async () => {
		vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

		const token = {
			accessToken: 'old-access-token',
			expires_at: 0,
			refreshToken: 'refresh-token',
			user: {
				email: 'operator@example.com',
				id: 'user_1',
				role: 'OWNER',
			},
		} as JWT
		const deleteCookie = vi.fn()
		vi.mocked(cookies).mockReturnValue({
			delete: deleteCookie,
			get: vi.fn((name: string) =>
				name === 'authjs.session-token' ? { value: 'encoded-token' } : undefined,
			),
			set: vi.fn(),
		} as never)
		vi.mocked(decode).mockResolvedValue(token)
		vi.mocked(cognitoRefreshAccessToken).mockResolvedValue({
			...token,
			accessToken: 'new-access-token',
			expires_at: 1780822800,
		} as JWT)
		vi.mocked(encode).mockRejectedValue(new Error('cookie write failed'))

		await expect(refreshAuthSession()).resolves.toBeNull()

		expect(deleteCookie).toHaveBeenCalledWith('authjs.session-token')
		expect(deleteCookie).toHaveBeenCalledWith(PASSWORD_SESSION_COOKIE_NAME)
		consoleError.mockRestore()
	})
})

describe('getAuthPkceDiagnostics', () => {
	it('returns false booleans when the pkce cookie is absent', async () => {
		vi.stubEnv('AUTH_SECRET', 'test-auth-secret')

		await expect(
			getAuthPkceDiagnostics(new Request('https://courseboard.txcloud.app')),
		).resolves.toEqual({ decrypt: false, present: false })
	})
})
