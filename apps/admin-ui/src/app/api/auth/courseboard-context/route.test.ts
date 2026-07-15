import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const {
	loadCourseboardTenantsMock,
	resolveWebCourseboardPrincipalMock,
	toCourseboardPublicContextMock,
} = vi.hoisted(() => ({
	loadCourseboardTenantsMock: vi.fn(),
	resolveWebCourseboardPrincipalMock: vi.fn(),
	toCourseboardPublicContextMock: vi.fn(),
}))

vi.mock('lib/courseboard-auth-context', () => ({
	loadCourseboardTenants: loadCourseboardTenantsMock,
	resolveWebCourseboardPrincipal: resolveWebCourseboardPrincipalMock,
	toCourseboardPublicContext: toCourseboardPublicContextMock,
}))

const principal = {
	source: 'web-session',
	session: { accessToken: 'secret-token', user: { id: 'us_1' } },
}

describe('GET /api/auth/courseboard-context', () => {
	beforeEach(() => {
		loadCourseboardTenantsMock.mockReset()
		resolveWebCourseboardPrincipalMock.mockReset()
		toCourseboardPublicContextMock.mockReset()
	})

	it('returns 401 for a missing or expired canonical session', async () => {
		resolveWebCourseboardPrincipalMock.mockResolvedValue(undefined)

		const response = await GET()

		expect(response.status).toBe(401)
		expect(response.headers.get('cache-control')).toBe('no-store')
		expect(loadCourseboardTenantsMock).not.toHaveBeenCalled()
	})

	it('returns the authorized tenant context without credentials', async () => {
		resolveWebCourseboardPrincipalMock.mockResolvedValue(principal)
		loadCourseboardTenantsMock.mockResolvedValue({
			kind: 'ok',
			session: principal.session,
			tenants: [{ id: 'tn_1', name: 'Tenant', mode: 'production' }],
			partial: false,
		})
		toCourseboardPublicContextMock.mockReturnValue({
			user: { id: 'us_1', role: 'GENERAL' },
			tenants: [
				{
					id: 'tn_1',
					name: 'Tenant',
					mode: 'production',
					operatorId: 'tn_1',
					platformId: 'tn_platform',
				},
			],
			partial: false,
		})

		const response = await GET()
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.tenants[0].operatorId).toBe('tn_1')
		expect(JSON.stringify(body)).not.toContain('secret-token')
	})

	it('returns 503 when tenant authorization cannot be resolved', async () => {
		resolveWebCourseboardPrincipalMock.mockResolvedValue(principal)
		loadCourseboardTenantsMock.mockResolvedValue({ kind: 'unavailable' })

		const response = await GET()

		expect(response.status).toBe(503)
		await expect(response.json()).resolves.toMatchObject({
			code: 'TENANT_DIRECTORY_UNAVAILABLE',
		})
	})

	it('preserves a safe partial tenant result', async () => {
		resolveWebCourseboardPrincipalMock.mockResolvedValue(principal)
		loadCourseboardTenantsMock.mockResolvedValue({
			kind: 'ok',
			session: principal.session,
			tenants: [{ id: 'tn_proven', name: 'Proven', mode: 'sandbox' }],
			partial: true,
		})
		toCourseboardPublicContextMock.mockReturnValue({
			user: { id: 'us_1', role: 'GENERAL' },
			tenants: [{ id: 'tn_proven' }],
			partial: true,
		})

		const response = await GET()

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toMatchObject({
			tenants: [{ id: 'tn_proven' }],
			partial: true,
		})
	})
})
