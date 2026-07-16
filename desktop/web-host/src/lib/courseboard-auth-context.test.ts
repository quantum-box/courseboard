import type { Session } from 'next-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TenantFetchError, TenantFetchPartialError } from './tenantFetcher'
import {
	isUsableCourseboardSession,
	loadCourseboardTenants,
	resolveBearerCourseboardPrincipal,
	resolveFieldCourseboardPrincipal,
	toCourseboardPublicContext,
} from './courseboard-auth-context'

const {
	authMock,
	fetchTenantsMock,
	refreshAuthSessionMock,
	verifyAccessTokenMock,
} = vi.hoisted(() => ({
	authMock: vi.fn(),
	fetchTenantsMock: vi.fn(),
	refreshAuthSessionMock: vi.fn(),
	verifyAccessTokenMock: vi.fn(),
}))

vi.mock('app/auth', () => ({
	auth: authMock,
	refreshAuthSession: refreshAuthSessionMock,
	verifyAccessToken: verifyAccessTokenMock,
}))

vi.mock('./tenantFetcher', async importOriginal => {
	const actual = await importOriginal<typeof import('./tenantFetcher')>()
	return {
		...actual,
		default: fetchTenantsMock,
	}
})

function session(
	accessToken = 'web-token',
	overrides: Partial<Session> = {},
) {
	return {
		accessToken,
		expires: '2099-01-01T00:00:00.000Z',
		user: {
			id: 'us_web',
			username: 'operator',
			name: 'Operator',
			email: 'operator@example.com',
			role: 'GENERAL',
		},
		...overrides,
	} as Session
}

describe('courseboard auth context', () => {
	beforeEach(() => {
		authMock.mockReset()
		fetchTenantsMock.mockReset()
		refreshAuthSessionMock.mockReset()
		verifyAccessTokenMock.mockReset()
	})

	it('rejects missing and explicitly failed canonical sessions', () => {
		expect(isUsableCourseboardSession(null)).toBe(false)
		expect(
			isUsableCourseboardSession(
				session('', { error: 'RefreshAccessTokenError' }),
			),
		).toBe(false)
	})

	it('verifies a native bearer and never trusts it without verification', async () => {
		verifyAccessTokenMock.mockResolvedValue({
			user: { id: 'us_native', role: 'ADMIN', tenants: ['tn_claimed'] },
		})

		const principal = await resolveBearerCourseboardPrincipal(
			new Request('https://courseboard.example/api/auth/native-profile', {
				headers: { authorization: 'Bearer native.jwt.token' },
			}),
		)

		expect(principal).toMatchObject({
			source: 'bearer',
			session: {
				accessToken: 'native.jwt.token',
				user: { id: 'us_native', role: 'ADMIN' },
			},
		})
		expect(verifyAccessTokenMock).toHaveBeenCalledWith('native.jwt.token')
	})

	it('rejects malformed and failed native bearers', async () => {
		await expect(
			resolveBearerCourseboardPrincipal(
				new Request('https://courseboard.example/api/auth/native-profile', {
					headers: { authorization: 'Basic secret' },
				}),
			),
		).resolves.toBeUndefined()
		expect(verifyAccessTokenMock).not.toHaveBeenCalled()

		verifyAccessTokenMock.mockRejectedValueOnce(new Error('invalid token'))
		await expect(
			resolveBearerCourseboardPrincipal(
				new Request('https://courseboard.example/api/auth/native-profile', {
					headers: { authorization: 'Bearer invalid.jwt.token' },
				}),
			),
		).resolves.toBeUndefined()
	})

	it('prefers the canonical cookie principal over a client bearer', async () => {
		authMock.mockResolvedValue(session())

		const principal = await resolveFieldCourseboardPrincipal(
			new Request('https://courseboard.example/field-api/v1/invoices', {
				headers: { authorization: 'Bearer another.jwt.token' },
			}),
		)

		expect(principal?.source).toBe('web-session')
		expect(principal?.session.accessToken).toBe('web-token')
		expect(verifyAccessTokenMock).not.toHaveBeenCalled()
	})

	it('refreshes a web session after a tenant-directory 401 and returns the fresh token', async () => {
		fetchTenantsMock
			.mockRejectedValueOnce(new TenantFetchError(401, 'expired'))
			.mockResolvedValueOnce([
				{ id: 'tn_allowed', name: 'Allowed', mode: 'production' },
			])
		refreshAuthSessionMock.mockResolvedValue(session('fresh-token'))

		await expect(
			loadCourseboardTenants({
				source: 'web-session',
				session: session('old-token'),
			}),
		).resolves.toMatchObject({
			kind: 'ok',
			session: { accessToken: 'fresh-token' },
			tenants: [{ id: 'tn_allowed' }],
			partial: false,
		})
	})

	it('keeps proven tenants from a partial platform result', async () => {
		fetchTenantsMock.mockRejectedValueOnce(
			new TenantFetchPartialError(
				[{ id: 'tn_proven', name: 'Proven', mode: 'sandbox' }],
				new Error('production unavailable'),
			),
		)

		await expect(
			loadCourseboardTenants({
				source: 'bearer',
				session: session('native-token'),
			}),
		).resolves.toMatchObject({
			kind: 'ok',
			partial: true,
			tenants: [{ id: 'tn_proven' }],
		})
	})

	it('maps a complete authorization denial to an empty tenant list', async () => {
		fetchTenantsMock.mockRejectedValueOnce(
			new TenantFetchError(403, 'forbidden'),
		)

		await expect(
			loadCourseboardTenants({
				source: 'bearer',
				session: session('native-token'),
			}),
		).resolves.toMatchObject({ kind: 'ok', tenants: [], partial: false })
	})

	it('serializes rich tenant context without exposing credentials or tenant claims', () => {
		const context = toCourseboardPublicContext(
			session('secret-access-token'),
			[
				{
					id: 'tn_allowed',
					name: 'Allowed',
					slug: 'allowed',
					mode: 'sandbox',
					platformId: 'untrusted-parent',
				},
			],
			false,
		)

		expect(context).toEqual({
			user: {
				id: 'us_web',
				username: 'operator',
				name: 'Operator',
				email: 'operator@example.com',
				role: 'GENERAL',
			},
			tenants: [
				{
					id: 'tn_allowed',
					name: 'Allowed',
					slug: 'allowed',
					mode: 'sandbox',
					platformId: 'tn_01hjryxysgey07h5jz5wagqj0m',
					operatorId: 'tn_allowed',
				},
			],
			partial: false,
		})
		expect(JSON.stringify(context)).not.toContain('secret-access-token')
		expect(JSON.stringify(context)).not.toContain('refreshToken')
	})
})
