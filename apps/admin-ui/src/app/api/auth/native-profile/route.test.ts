import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, OPTIONS } from './route'

const {
	loadCourseboardTenantsMock,
	resolveBearerCourseboardPrincipalMock,
	toCourseboardPublicContextMock,
} = vi.hoisted(() => ({
	loadCourseboardTenantsMock: vi.fn(),
	resolveBearerCourseboardPrincipalMock: vi.fn(),
	toCourseboardPublicContextMock: vi.fn(),
}))

vi.mock('lib/courseboard-auth-context', () => ({
	loadCourseboardTenants: loadCourseboardTenantsMock,
	resolveBearerCourseboardPrincipal: resolveBearerCourseboardPrincipalMock,
	toCourseboardPublicContext: toCourseboardPublicContextMock,
}))

function request(headers: Record<string, string> = {}) {
	return new Request(
		'https://courseboard.example/api/auth/native-profile',
		{ headers },
	)
}

describe('GET /api/auth/native-profile', () => {
	beforeEach(() => {
		loadCourseboardTenantsMock.mockReset()
		resolveBearerCourseboardPrincipalMock.mockReset()
		toCourseboardPublicContextMock.mockReset()
	})

	it('returns 401 for an invalid bearer', async () => {
		resolveBearerCourseboardPrincipalMock.mockResolvedValue(undefined)

		const response = await GET(
			request({ authorization: 'Bearer invalid.jwt.token' }),
		)

		expect(response.status).toBe(401)
		expect(loadCourseboardTenantsMock).not.toHaveBeenCalled()
	})

	it('returns verified profile and tenant context to a Tauri origin', async () => {
		const principal = {
			source: 'bearer',
			session: { accessToken: 'native-token', user: { id: 'us_native' } },
		}
		resolveBearerCourseboardPrincipalMock.mockResolvedValue(principal)
		loadCourseboardTenantsMock.mockResolvedValue({
			kind: 'ok',
			session: principal.session,
			tenants: [{ id: 'tn_allowed', name: 'Allowed', mode: 'production' }],
			partial: false,
		})
		toCourseboardPublicContextMock.mockReturnValue({
			user: { id: 'us_native', role: 'GENERAL' },
			tenants: [{ id: 'tn_allowed', operatorId: 'tn_allowed' }],
			partial: false,
		})

		const response = await GET(
			request({
				authorization: 'Bearer native-token',
				origin: 'tauri://localhost',
			}),
		)
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(response.headers.get('access-control-allow-origin')).toBe(
			'tauri://localhost',
		)
		expect(body.tenants).toEqual([
			{ id: 'tn_allowed', operatorId: 'tn_allowed' },
		])
		expect(JSON.stringify(body)).not.toContain('native-token')
	})

	it('rejects arbitrary browser origins before bearer verification', async () => {
		const response = await GET(
			request({
				authorization: 'Bearer native-token',
				origin: 'https://evil.example',
			}),
		)

		expect(response.status).toBe(403)
		expect(resolveBearerCourseboardPrincipalMock).not.toHaveBeenCalled()
	})

	it('supports a narrow Tauri preflight', async () => {
		const response = await OPTIONS(
			request({
				origin: 'http://tauri.localhost',
				'access-control-request-method': 'GET',
				'access-control-request-headers': 'authorization, accept',
			}),
		)

		expect(response.status).toBe(204)
		expect(response.headers.get('access-control-allow-origin')).toBe(
			'http://tauri.localhost',
		)
	})
})
