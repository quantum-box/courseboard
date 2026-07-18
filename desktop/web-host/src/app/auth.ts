import { resolveAuthUrl } from 'lib/auth-url'
import { getRuntimeEnv } from 'lib/runtime-env'
import type { NextAuthConfig, Session } from 'next-auth'
import NextAuth from 'next-auth'
import { JWT, decode, encode } from 'next-auth/jwt'
import CognitoProvider from 'next-auth/providers/cognito'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { resolveAccountExpiresAt } from './auth-token'
import { isAdminRole, resolveJwtUser } from './auth-user'
import { cognitoRefreshAccessToken } from './cognito'

export { isAdminRole }
export { resolveAuthUrl }

const DEFAULT_AUTH_BACKEND_URL = 'https://api.n1.tachy.one'
export const PASSWORD_SESSION_COOKIE_NAME = 'tachyon-password-session'
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
export const AUTH_SIGN_IN_PATH = '/courseboard-ui/index.html'
const TOKEN_REFRESH_WINDOW_SECONDS = 5 * 60
const PASSWORD_SESSION_COOKIE_CHUNK_SIZE = 3800
const PASSWORD_SESSION_COOKIE_MAX_CHUNKS = 12
export const AUTHJS_PKCE_COOKIE_NAME = '__Secure-authjs.pkce.code_verifier'

const AUTHJS_SESSION_COOKIE_CHUNK_SIZE = PASSWORD_SESSION_COOKIE_MAX_CHUNKS
const AUTHJS_SESSION_COOKIE_BASE_NAMES = [
	'authjs.session-token',
	'__Secure-authjs.session-token',
	'next-auth.session-token',
	'__Secure-next-auth.session-token',
] as const

const authJsSessionCookieNames = AUTHJS_SESSION_COOKIE_BASE_NAMES.flatMap(
	name => [
		name,
		...Array.from(
			{ length: AUTHJS_SESSION_COOKIE_CHUNK_SIZE },
			(_, index) => `${name}.${index}`,
		),
	],
)

export const AUTH_SESSION_COOKIE_NAMES = [
	PASSWORD_SESSION_COOKIE_NAME,
	...Array.from(
		{ length: PASSWORD_SESSION_COOKIE_MAX_CHUNKS - 1 },
		(_, index) => `${PASSWORD_SESSION_COOKIE_NAME}.${index + 1}`,
	),
	...authJsSessionCookieNames,
	AUTHJS_PKCE_COOKIE_NAME,
] as const

type VerifyResponse = {
	user: {
		id: string
		username?: string
		name?: string | null
		email?: string | null
		role?: string
		tenants?: string[]
	}
	tenants?: Array<
		| string
		| {
				id?: string
				name?: string
				slug?: string
				mode?: 'production' | 'sandbox'
				platformId?: string
		  }
	>
}

type AuthInstrumentationOptions = {
	onCheckFailed?: (check: 'pkce' | 'state' | 'nonce') => void
	onLoggerErrorName?: (name: string) => void
}

function getAuthSecret(options: { authUrl?: string } = {}) {
	const authSecret =
		getRuntimeEnv('AUTH_SECRET') ?? getRuntimeEnv('NEXTAUTH_SECRET')

	if (authSecret) {
		return authSecret
	}

	if (options.authUrl && options.authUrl !== resolveAuthUrl()) {
		return `courseboard-preview-auth-secret:${options.authUrl}`
	}

	const fallbackAuthUrl = resolveAuthUrl()
	if (fallbackAuthUrl !== 'https://courseboard.txcloud.app') {
		return `courseboard-preview-auth-secret:${fallbackAuthUrl}`
	}

	throw new Error('AUTH_SECRET or NEXTAUTH_SECRET must be configured')
}

function normalizeHeaderToken(value: string | undefined) {
	if (!value) return undefined
	const normalized = value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80)
	return normalized || undefined
}

function getAuthJsLoggerErrorName(error: Error) {
	const authErrorType = (error as { type?: unknown }).type
	if (typeof authErrorType === 'string') {
		const normalizedType = normalizeHeaderToken(authErrorType)
		if (normalizedType) return normalizedType
	}

	return (
		normalizeHeaderToken(error.name) ??
		normalizeHeaderToken(error.constructor.name) ??
		'Error'
	)
}

function getAuthJsCheckFailure(error: Error) {
	if ((error as { type?: unknown }).type !== 'InvalidCheck') {
		return undefined
	}

	const message = error.message.toLowerCase()
	if (message.includes('pkce')) return 'pkce'
	if (message.includes('state')) return 'state'
	if (message.includes('nonce')) return 'nonce'
	return undefined
}

async function fingerprintAuthSecret(secret: string) {
	const bytes = new TextEncoder().encode(secret)
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return Array.from(new Uint8Array(digest))
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 12)
}

export async function getAuthSecretFingerprint() {
	return fingerprintAuthSecret(getAuthSecret())
}

export async function getAuthSecretFingerprintForRequest(request: Request) {
	return fingerprintAuthSecret(
		getAuthSecret({ authUrl: resolveAuthUrl(request) }),
	)
}

function readCookieValue(request: Request, name: string) {
	const cookieHeader = request.headers.get('cookie')
	if (!cookieHeader) return undefined

	for (const cookie of cookieHeader.split(';')) {
		const [rawName, ...rawValue] = cookie.trim().split('=')
		if (rawName === name) {
			return rawValue.join('=')
		}
	}
	return undefined
}

export async function getAuthPkceDiagnostics(request: Request) {
	const token = readCookieValue(request, AUTHJS_PKCE_COOKIE_NAME)
	const present = Boolean(token)
	if (!token) {
		return { decrypt: false, present }
	}

	try {
		const decoded = await decode({
			salt: AUTHJS_PKCE_COOKIE_NAME,
			secret: getAuthSecret({ authUrl: resolveAuthUrl(request) }),
			token,
		})
		return { decrypt: Boolean(decoded?.value), present }
	} catch {
		return { decrypt: false, present }
	}
}

export async function encodePasswordSessionToken(token: JWT) {
	return encode({
		maxAge: SESSION_MAX_AGE_SECONDS,
		salt: PASSWORD_SESSION_COOKIE_NAME,
		secret: getAuthSecret(),
		token,
	})
}

export function readPasswordSessionCookieValue() {
	const cookieStore = cookies()
	const firstChunk = cookieStore.get(PASSWORD_SESSION_COOKIE_NAME)?.value
	if (!firstChunk) {
		return undefined
	}

	let value = firstChunk
	for (let index = 1; index < PASSWORD_SESSION_COOKIE_MAX_CHUNKS; index += 1) {
		const chunk = cookieStore.get(
			`${PASSWORD_SESSION_COOKIE_NAME}.${index}`,
		)?.value
		if (!chunk) break
		value += chunk
	}
	return value
}

export function splitPasswordSessionCookieValue(value: string) {
	const chunks: Array<{ name: string; value: string }> = []
	for (
		let offset = 0, index = 0;
		offset < value.length;
		offset += PASSWORD_SESSION_COOKIE_CHUNK_SIZE, index += 1
	) {
		if (index >= PASSWORD_SESSION_COOKIE_MAX_CHUNKS) {
			throw new Error('Password session token exceeds cookie chunk limit')
		}
		chunks.push({
			name:
				index === 0
					? PASSWORD_SESSION_COOKIE_NAME
					: `${PASSWORD_SESSION_COOKIE_NAME}.${index}`,
			value: value.slice(offset, offset + PASSWORD_SESSION_COOKIE_CHUNK_SIZE),
		})
	}
	return chunks
}

async function persistPasswordSessionToken(token: JWT) {
	const sessionToken = await encodePasswordSessionToken(token)
	const cookieStore = cookies()
	const secure = new URL(resolveAuthUrl()).protocol === 'https:'
	for (const name of AUTH_SESSION_COOKIE_NAMES) {
		cookieStore.delete(name)
	}
	for (const chunk of splitPasswordSessionCookieValue(sessionToken)) {
		cookieStore.set(chunk.name, chunk.value, {
			httpOnly: true,
			maxAge: SESSION_MAX_AGE_SECONDS,
			path: '/',
			sameSite: 'lax',
			secure,
		})
	}
}

export function clearAuthSessionCookies() {
	const cookieStore = cookies()
	for (const name of AUTH_SESSION_COOKIE_NAMES) {
		cookieStore.delete(name)
	}
}

function readAuthJsSessionCookieValue(
	cookieStore: ReturnType<typeof cookies>,
	name: string,
) {
	const directValue = cookieStore.get(name)?.value
	if (directValue) {
		return directValue
	}

	let chunkedValue = ''
	for (let index = 0; index < AUTHJS_SESSION_COOKIE_CHUNK_SIZE; index += 1) {
		const chunk = cookieStore.get(`${name}.${index}`)?.value
		if (!chunk) break
		chunkedValue += chunk
	}
	return chunkedValue || undefined
}

export async function verifyAccessToken(
	accessToken: string,
): Promise<VerifyResponse> {
	const backendUrl =
		getRuntimeEnv('TACHYON_API_URL') ??
		getRuntimeEnv('AUTH_BACKEND_API_URL') ??
		DEFAULT_AUTH_BACKEND_URL
	const response = await fetch(
		`${backendUrl.replace(/\/+$/, '')}/v1/me`,
		{
			headers: {
				accept: 'application/json',
				authorization: `Bearer ${accessToken}`,
			},
			cache: 'no-store',
		},
	)

	if (!response.ok) {
		throw new Error(`Failed to verify access token: ${response.status}`)
	}

	return response.json() as Promise<VerifyResponse>
}

export const createAuthConfig = (
	instrumentation: AuthInstrumentationOptions = {},
	options: { authUrl?: string } = {},
): NextAuthConfig => {
	// Platform auth (Cloud App `auth.enabled`): the Tachyon platform provisions the
	// OAuth2 client on the Tachyon user pool and injects COGNITO_CLIENT_ID/SECRET/
	// USER_POOL_ID. It registers the callback at /api/auth/callback/tachyon, so the
	// provider id must be "tachyon" (not the default "cognito"). Derive the issuer
	// from the injected user pool id when COGNITO_ISSUER is not explicitly set.
	const cognitoRegion = getRuntimeEnv('COGNITO_REGION') ?? 'ap-northeast-1'
	const cognitoUserPoolId = getRuntimeEnv('COGNITO_USER_POOL_ID')
	const cognitoIssuer =
		(getRuntimeEnv('COGNITO_ISSUER') as string | undefined) ??
		(cognitoUserPoolId
			? `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}`
			: '')
	const cognitoDomain =
		getRuntimeEnv('COGNITO_DOMAIN') ?? 'https://auth-pool.n1.tachy.one'
	const authSecret = getAuthSecret(options)
	const cognitoProvider = {
		...CognitoProvider({
			clientId: getRuntimeEnv('COGNITO_CLIENT_ID') as string,
			clientSecret: getRuntimeEnv('COGNITO_CLIENT_SECRET') as string,
			issuer: cognitoIssuer,
			authorization: {
				url: `${cognitoDomain}/oauth2/authorize`,
				params: {
					scope: 'openid profile email aws.cognito.signin.user.admin',
				},
			},
			token: `${cognitoDomain}/oauth2/token`,
			userinfo: `${cognitoDomain}/oauth2/userInfo`,
			jwks_endpoint: `${cognitoIssuer}/.well-known/jwks.json`,
		}),
		// Match the platform-registered callback /api/auth/callback/tachyon.
		id: 'tachyon',
	}

	return {
		providers: [cognitoProvider],
		callbacks: {
			authorized({ request }) {
				const { pathname } = request.nextUrl
				if (pathname === '/auth/signin') return true
				return true
			},
			jwt: async ({ token, account, profile }): Promise<JWT> => {
				if (account?.access_token) {
					// Cognito-only auth (no backend verify, per Ao): derive the user
					// directly from the Cognito token/profile claims. resolveJwtUser
					// falls back to the Cognito `sub`/`cognito:username` for id when no
					// verified user is supplied.
					return {
						...token,
						user: resolveJwtUser({
							token,
							profile: profile as Record<string, unknown> | undefined,
							verifiedUser: undefined,
						}),
						accessToken: account.access_token as string,
						refreshToken:
							(account.refresh_token as string | undefined) ??
							(token.refreshToken as string | undefined) ??
							'',
						expires_at: resolveAccountExpiresAt(account),
					}
				}
				// トークンが期限切れの場合
				if (!token.expires_at || Date.now() / 1000 > token.expires_at) {
					try {
						// console.log('token expired')
						const refreshedToken = await cognitoRefreshAccessToken(token)
						// console.log('refreshed token', refreshedToken)
						return refreshedToken
					} catch (error) {
						console.error('Error refreshing token:', error)
						return {
							...token,
							error: 'RefreshAccessTokenError',
						}
					}
				}

				return token
			},
			session: async ({ session, token }) => {
				if (!token.user) {
					return session
				}

				session.error = token.error
				session.accessToken = token.accessToken ?? ''
				session.user = {
					...token.user,
					email: token.user.email,
					emailVerified: null,
					role: token.user.role ?? 'GENERAL',
				}
				return session
			},
		},
		session: {
			strategy: 'jwt',
			maxAge: 30 * 24 * 60 * 60, // 30 days
		},
		cookies: {
			pkceCodeVerifier: {
				name: AUTHJS_PKCE_COOKIE_NAME,
				options: {
					httpOnly: true,
					maxAge: 60 * 15,
					path: '/',
					sameSite: 'lax',
					secure: true,
				},
			},
		},
		pages: {
			signOut: '/auth/sign_out',
		},
		basePath: '/api/auth',
		trustHost: true,
		secret: authSecret,
		logger: {
			error(error) {
				const check = getAuthJsCheckFailure(error)
				if (check) {
					instrumentation.onCheckFailed?.(check)
				}
				instrumentation.onLoggerErrorName?.(getAuthJsLoggerErrorName(error))
			},
		},
		debug: getRuntimeEnv('AUTH_DEBUG') === 'true',
	} satisfies NextAuthConfig
}

const createAuth = (instrumentation?: AuthInstrumentationOptions) =>
	NextAuth(createAuthConfig(instrumentation))

export const signIn: ReturnType<typeof NextAuth>['signIn'] = (...args) =>
	createAuth().signIn(...args)

export const signOut: ReturnType<typeof NextAuth>['signOut'] = (...args) =>
	createAuth().signOut(...args)

export const getAuthHandlers = (instrumentation?: AuthInstrumentationOptions) =>
	createAuth(instrumentation).handlers

function sessionFromJwtToken(token: JWT, expiresAt: number): Session {
	return {
		accessToken: token.accessToken,
		error: token.error,
		expires: new Date(expiresAt * 1000).toISOString(),
		user: {
			...token.user,
			email: token.user.email,
			emailVerified: null,
			role: token.user.role ?? 'GENERAL',
		},
	} as Session
}

async function getPasswordSession(
	options: { forceRefresh?: boolean } = {},
): Promise<Session | null> {
	const sessionCookie = readPasswordSessionCookieValue()
	if (!sessionCookie) {
		return null
	}

	try {
		const token = await decode({
			salt: PASSWORD_SESSION_COOKIE_NAME,
			secret: getAuthSecret(),
			token: sessionCookie,
		})
		if (!token?.user || !token.accessToken) {
			return null
		}

		const expiresAt =
			(token.expires_at as number | undefined) ??
			Math.floor(Date.now() / 1000 + SESSION_MAX_AGE_SECONDS)
		let sessionToken = token
		let sessionExpiresAt = expiresAt
		if (
			options.forceRefresh ||
			Date.now() / 1000 > expiresAt - TOKEN_REFRESH_WINDOW_SECONDS
		) {
			if (!token.refreshToken) {
				return {
					accessToken: '',
					error: 'RefreshAccessTokenError',
					expires: new Date(expiresAt * 1000).toISOString(),
					user: {
						...token.user,
						email: token.user.email,
						emailVerified: null,
						role: token.user.role ?? 'GENERAL',
					},
				} as Session
			}
			sessionToken = await cognitoRefreshAccessToken(token)
			if (
				sessionToken.error === 'RefreshAccessTokenError' ||
				!sessionToken.accessToken
			) {
				return {
					accessToken: '',
					error: 'RefreshAccessTokenError',
					expires: new Date(expiresAt * 1000).toISOString(),
					user: {
						...token.user,
						email: token.user.email,
						emailVerified: null,
						role: token.user.role ?? 'GENERAL',
					},
				} as Session
			}
			sessionExpiresAt =
				(sessionToken.expires_at as number | undefined) ?? sessionExpiresAt
			try {
				await persistPasswordSessionToken(sessionToken)
			} catch (error) {
				console.error('Failed to persist refreshed password session:', error)
				return {
					accessToken: '',
					error: 'RefreshAccessTokenError',
					expires: new Date(sessionExpiresAt * 1000).toISOString(),
					user: {
						...sessionToken.user,
						email: sessionToken.user.email,
						emailVerified: null,
						role: sessionToken.user.role ?? 'GENERAL',
					},
				} as Session
			}
		}
		if (Date.now() / 1000 > sessionExpiresAt) {
			return {
				accessToken: '',
				error: 'RefreshAccessTokenError',
				expires: new Date(sessionExpiresAt * 1000).toISOString(),
				user: {
					...sessionToken.user,
					email: sessionToken.user.email,
					emailVerified: null,
					role: sessionToken.user.role ?? 'GENERAL',
				},
			} as Session
		}

		return {
			...sessionFromJwtToken(sessionToken, sessionExpiresAt),
		}
	} catch (error) {
		console.error('Failed to decode password session:', error)
		return null
	}
}

async function readAuthJsSessionToken(): Promise<JWT | null> {
	const cookieStore = cookies()
	const secret = getAuthSecret()
	for (const name of AUTHJS_SESSION_COOKIE_BASE_NAMES) {
		const cookieValue = readAuthJsSessionCookieValue(cookieStore, name)
		if (!cookieValue) continue
		try {
			const token = await decode({
				salt: name,
				secret,
				token: cookieValue,
			})
			if (token?.accessToken && token.refreshToken && token.user) {
				return token
			}
		} catch {}
	}
	return null
}

async function refreshAuthJsSession(): Promise<Session | null> {
	const token = await readAuthJsSessionToken()
	if (!token) {
		return null
	}
	const refreshedToken = await cognitoRefreshAccessToken(token)
	if (
		refreshedToken.error === 'RefreshAccessTokenError' ||
		!refreshedToken.accessToken
	) {
		return null
	}
	const expiresAt =
		(refreshedToken.expires_at as number | undefined) ??
		Math.floor(Date.now() / 1000 + SESSION_MAX_AGE_SECONDS)
	try {
		// A refresh is only complete after the next request can read the rotated
		// access/refresh token pair. Migrate the Auth.js JWT into the same
		// server-owned cookie used by password sessions so the BFF can persist it
		// without exposing either token to the browser runtime.
		await persistPasswordSessionToken(refreshedToken)
	} catch (error) {
		console.error('Failed to persist refreshed Auth.js session:', error)
		return null
	}
	return sessionFromJwtToken(refreshedToken, expiresAt)
}

export const auth = cache(async (): Promise<Session | null> => {
	return getPasswordSession().then(passwordSession => {
		if (passwordSession) {
			return passwordSession
		}
		return createAuth()
			.auth()
			.then(session => {
				if (!session || !('user' in session)) {
					return null
				}
				return session
			})
			.catch(error => {
				console.error('Failed to resolve auth session:', error)
				return null
			})
	})
})

export async function refreshAuthSession(): Promise<Session | null> {
	const passwordSession = await getPasswordSession({ forceRefresh: true })
	if (
		passwordSession?.accessToken &&
		passwordSession.error !== 'RefreshAccessTokenError'
	) {
		return passwordSession
	}
	const authJsSession = await refreshAuthJsSession()
	if (authJsSession) {
		return authJsSession
	}
	clearAuthSessionCookies()
	return null
}

export async function authWithCheck() {
	const session = await auth()
	if (!session) {
		redirect(authRedirectUrl(AUTH_SIGN_IN_PATH))
	}
	if (
		session?.error === 'RefreshAccessTokenError' ||
		session?.error === 'VerifyAccessTokenError'
	) {
		redirect(authRedirectUrl('/auth/sign_out?error=expired'))
	}
	return session
}

export function authRedirectUrl(path: string) {
	return new URL(path, resolveAuthUrl()).toString()
}
