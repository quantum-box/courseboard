import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	GET,
	OPTIONS,
	PATCH,
	isAllowedCourseRoute,
} from './route'

const {
	loadCourseboardTenantsMock,
	resolveFieldCourseboardPrincipalMock,
} = vi.hoisted(() => ({
	loadCourseboardTenantsMock: vi.fn(),
	resolveFieldCourseboardPrincipalMock: vi.fn(),
}))

vi.mock('lib/courseboard-auth-context', () => ({
	loadCourseboardTenants: loadCourseboardTenantsMock,
	resolveFieldCourseboardPrincipal: resolveFieldCourseboardPrincipalMock,
}))

vi.mock('lib/serverCourseApiUrl', () => ({
	getServerCourseApiBaseUrl: () => 'https://course-api.example',
	joinServerCourseApiPath: (path: string) => `https://course-api.example${path}`,
}))

const principal = {
	source: 'web-session',
	session: { accessToken: 'canonical-token', user: { id: 'us_1' } },
}

const allowedTenant = {
	id: 'tn_allowed',
	name: 'Allowed',
	mode: 'production',
}

function routeContext(path: string) {
	const suffix = path.replace(/^\/v1\/course\//, '')
	return { params: { path: suffix.split('/') } }
}

function request(
	path: string,
	options: {
		method?: string
		query?: string
		headers?: Record<string, string>
		body?: string
	} = {},
) {
	return new Request(
		`https://courseboard.example${path}${options.query ?? ''}`,
		{
			method: options.method ?? 'GET',
			headers: {
				'x-operator-id': 'tn_allowed',
				...options.headers,
			},
			body: options.body,
		},
	)
}

describe('Course API route allowlist', () => {
	it('allows CourseBoard course-api surfaces', () => {
		expect(isAllowedCourseRoute('GET', '/v1/course/tee-sheet')).toBe(true)
		expect(isAllowedCourseRoute('GET', '/v1/course/courses')).toBe(true)
		expect(
			isAllowedCourseRoute('PATCH', '/v1/course/courses/course_1'),
		).toBe(true)
		expect(
			isAllowedCourseRoute(
				'PUT',
				'/v1/course/reservation-products/svc:golf/slots',
			),
		).toBe(true)
		expect(
			isAllowedCourseRoute(
				'GET',
				'/v1/course/monthly-settlement/export.csv',
			),
		).toBe(true)
	})

	it('rejects Field golf paths and unsafe segments', () => {
		expect(
			isAllowedCourseRoute(
				'GET',
				'/v1/erp/extensions/golf-course/courses',
			),
		).toBe(false)
		expect(isAllowedCourseRoute('GET', '/v1/course')).toBe(false)
		expect(isAllowedCourseRoute('GET', '/v1/course/../auth')).toBe(false)
	})
})

describe('/v1/course/[...path] BFF', () => {
	beforeEach(() => {
		loadCourseboardTenantsMock.mockReset()
		resolveFieldCourseboardPrincipalMock.mockReset()
		resolveFieldCourseboardPrincipalMock.mockResolvedValue(principal)
		loadCourseboardTenantsMock.mockResolvedValue({
			kind: 'ok',
			session: principal.session,
			tenants: [allowedTenant],
			partial: false,
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('proxies tee-sheet to Rust course-api with server-derived auth', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					date: '2026-07-18',
					timezone: 'Asia/Tokyo',
					dayStart: '2026-07-18T06:00:00+09:00',
					dayEnd: '2026-07-18T18:00:00+09:00',
					items: [],
				}),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			),
		)
		vi.stubGlobal('fetch', fetchMock)

		const response = await GET(
			request('/v1/course/tee-sheet', {
				query: '?date=2026-07-18',
				headers: {
					authorization: 'Bearer client-spoof',
					'x-platform-id': 'tn_spoofed_platform',
				},
			}),
			routeContext('/v1/course/tee-sheet'),
		)

		expect(response.status).toBe(200)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
		expect(url.toString()).toBe(
			'https://course-api.example/v1/course/tee-sheet?date=2026-07-18',
		)
		const headers = init.headers as Headers
		expect(headers.get('authorization')).toBe('Bearer canonical-token')
		expect(headers.get('x-operator-id')).toBe('tn_allowed')
		expect(headers.get('x-platform-id')).toBe(
			'tn_01hjjn348rn3t49zz6hvmfq67p',
		)
		await expect(response.json()).resolves.toMatchObject({
			date: '2026-07-18',
			items: [],
		})
	})

	it('forwards PATCH bodies to course-api', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: 'course_1' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const response = await PATCH(
			request('/v1/course/courses/course_1', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'East' }),
			}),
			routeContext('/v1/course/courses/course_1'),
		)

		expect(response.status).toBe(200)
		const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
		expect(url.pathname).toBe('/v1/course/courses/course_1')
		expect(init.method).toBe('PATCH')
		expect(init.body).toBeInstanceOf(ArrayBuffer)
	})

	it('rejects unauthenticated callers before contacting course-api', async () => {
		resolveFieldCourseboardPrincipalMock.mockResolvedValue(null)
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)

		const response = await GET(
			request('/v1/course/tee-sheet', { query: '?date=2026-07-18' }),
			routeContext('/v1/course/tee-sheet'),
		)

		expect(response.status).toBe(401)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('answers CORS preflight for native clients', async () => {
		const response = await OPTIONS(
			new Request('https://courseboard.example/v1/course/tee-sheet', {
				method: 'OPTIONS',
				headers: {
					origin: 'tauri://localhost',
					'access-control-request-method': 'GET',
				},
			}),
		)
		expect(response.status).toBeLessThan(400)
	})
})
