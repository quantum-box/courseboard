import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	GET,
	OPTIONS,
	PATCH,
	POST,
	isAllowedFieldRoute,
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

vi.mock('lib/serverBackendUrl', () => ({
	joinServerBackendPath: (path: string) => `https://field.example${path}`,
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
	return { params: { path: path.replace(/^\/+/, '').split('/') } }
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
		`https://courseboard.example/field-api${path}${options.query ?? ''}`,
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

describe('Field API route allowlist', () => {
	it('matches the Course Board golf, staff, reservation and invoice surfaces', () => {
		expect(isAllowedFieldRoute('GET', '/v1/erp/extensions/status')).toBe(true)
		expect(
			isAllowedFieldRoute(
				'PATCH',
				'/v1/erp/extensions/golf-course/courses/course_1',
			),
		).toBe(true)
		expect(
			isAllowedFieldRoute(
				'PATCH',
				'/v1/erp/extensions/golf-course/reservation-products/svc:golf',
			),
		).toBe(true)
		expect(
			isAllowedFieldRoute(
				'PATCH',
				'/v1/erp/extensions/golf-course/reservation-products/_internal',
			),
		).toBe(true)
		expect(isAllowedFieldRoute('POST', '/v1/erp/staff')).toBe(true)
		expect(
			isAllowedFieldRoute(
				'POST',
				'/v1/erp/reservations/res_1/billing-invoice',
			),
		).toBe(true)
		expect(isAllowedFieldRoute('PATCH', '/v1/invoices/inv_1')).toBe(true)
		expect(isAllowedFieldRoute('POST', '/v1/invoices/inv_1/fulfill')).toBe(
			true,
		)
	})

	it('allows only a single order lookup and forbids order list access', () => {
		expect(isAllowedFieldRoute('GET', '/v1/erp/orders/order_1')).toBe(true)
		expect(isAllowedFieldRoute('GET', '/v1/erp/orders')).toBe(false)
		expect(isAllowedFieldRoute('POST', '/v1/erp/orders/order_1')).toBe(false)
		expect(isAllowedFieldRoute('GET', '/v1/erp/orders/order_1/private')).toBe(
			false,
		)
	})

	it('rejects unsafe, adjacent and wrong-method routes', () => {
		expect(isAllowedFieldRoute('GET', '/v1/erp/staff-secrets')).toBe(false)
		expect(isAllowedFieldRoute('GET', '/v1/invoices-private')).toBe(false)
		expect(isAllowedFieldRoute('GET', '/v1/invoices/../auth/users')).toBe(
			false,
		)
		expect(isAllowedFieldRoute('DELETE', '/v1/invoices/inv_1')).toBe(false)
		expect(isAllowedFieldRoute('GET', '/v1/invoices/inv_1/fulfill')).toBe(
			false,
		)
	})
})

describe('/field-api/[...path] BFF', () => {
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

	it('forwards only server-derived auth and tenant scope', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ items: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const response = await GET(
			request('/v1/invoices', {
				query: '?status=pending',
				headers: {
					authorization: 'Bearer client-spoof',
					'x-platform-id': 'tn_spoofed_platform',
				},
			}),
			routeContext('/v1/invoices'),
		)

		expect(response.status).toBe(200)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
		expect(url.toString()).toBe(
			'https://field.example/v1/invoices?status=pending',
		)
		const headers = init.headers as Headers
		expect(headers.get('authorization')).toBe('Bearer canonical-token')
		expect(headers.get('x-operator-id')).toBe('tn_allowed')
		expect(headers.get('x-platform-id')).toBe(
			'tn_01hjjn348rn3t49zz6hvmfq67p',
		)
	})

	it('does not expire a verified OAuth session when Field API rejects the token format', async () => {
		resolveFieldCourseboardPrincipalMock.mockResolvedValue({
			...principal,
			source: 'bearer',
		})
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					message: 'Tachyon auth verify_user rejected the request',
				}),
				{ status: 401, headers: { 'content-type': 'application/json' } },
			),
		)
		vi.stubGlobal('fetch', fetchMock)

		const response = await GET(
			request('/v1/erp/extensions/status'),
			routeContext('/v1/erp/extensions/status'),
		)

		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toEqual({
			code: 'FIELD_API_OAUTH_INCOMPATIBLE',
			message: 'Field API rejected a token already verified by Tachyon Auth',
		})
	})

	it('accepts a URL-encoded colon in a decoded service id', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ id: 'svc:golf' })))
		vi.stubGlobal('fetch', fetchMock)
		const decodedPath =
			'/v1/erp/extensions/golf-course/reservation-products/svc:golf'

		const response = await GET(
			new Request(
				'https://courseboard.example/field-api/v1/erp/extensions/golf-course/reservation-products/svc%3Agolf',
				{ headers: { 'x-operator-id': 'tn_allowed' } },
			),
			routeContext(decodedPath),
		)

		expect(response.status).toBe(200)
		const [url] = fetchMock.mock.calls[0] as [URL]
		expect(url.pathname).toBe(decodedPath)
	})

	it('forwards allowed invoice PATCH bodies and idempotency keys', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
		vi.stubGlobal('fetch', fetchMock)

		const response = await PATCH(
			request('/v1/invoices/inv_1', {
				method: 'PATCH',
				body: JSON.stringify({ status: 'sent' }),
				headers: {
					'content-type': 'application/json',
					'idempotency-key': 'invoice-update-1',
				},
			}),
			routeContext('/v1/invoices/inv_1'),
		)

		expect(response.status).toBe(204)
		const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
		expect(init.method).toBe('PATCH')
		expect(init.body).toBeInstanceOf(ArrayBuffer)
		expect((init.headers as Headers).get('idempotency-key')).toBe(
			'invoice-update-1',
		)
	})

	it('returns 401 when neither cookie nor bearer establishes a principal', async () => {
		resolveFieldCourseboardPrincipalMock.mockResolvedValue(undefined)
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)

		const response = await GET(
			request('/v1/invoices', {
				headers: { authorization: 'Bearer invalid.jwt.token' },
			}),
			routeContext('/v1/invoices'),
		)

		expect(response.status).toBe(401)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('returns 403 for a verified user requesting another tenant', async () => {
		loadCourseboardTenantsMock.mockResolvedValue({
			kind: 'ok',
			session: principal.session,
			tenants: [{ id: 'tn_other', name: 'Other', mode: 'production' }],
			partial: false,
		})
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)

		const response = await GET(
			request('/v1/invoices'),
			routeContext('/v1/invoices'),
		)

		expect(response.status).toBe(403)
		expect(response.headers.get('x-courseboard-auth-denial')).toBe('tenant')
		await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' })
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('does not turn a missing partial tenant result into a false 403', async () => {
		loadCourseboardTenantsMock.mockResolvedValue({
			kind: 'ok',
			session: principal.session,
			tenants: [{ id: 'tn_other', name: 'Other', mode: 'sandbox' }],
			partial: true,
		})

		const response = await GET(
			request('/v1/invoices'),
			routeContext('/v1/invoices'),
		)

		expect(response.status).toBe(503)
		await expect(response.json()).resolves.toMatchObject({
			code: 'TENANT_DIRECTORY_PARTIAL',
		})
	})

	it('rejects client-controlled tenant or platform query scope', async () => {
		const response = await GET(
			request('/v1/invoices', {
				query: '?x-platform-id=tn_spoofed&operator_id%5B%5D=tn_other',
			}),
			routeContext('/v1/invoices'),
		)

		expect(response.status).toBe(400)
		expect(resolveFieldCourseboardPrincipalMock).not.toHaveBeenCalled()
	})

	it('returns 404 for a forbidden order list without contacting auth or upstream', async () => {
		const response = await GET(
			request('/v1/erp/orders'),
			routeContext('/v1/erp/orders'),
		)

		expect(response.status).toBe(404)
		expect(resolveFieldCourseboardPrincipalMock).not.toHaveBeenCalled()
	})

	it('rejects arbitrary cross-origin side effects before authentication', async () => {
		const response = await POST(
			request('/v1/invoices', {
				method: 'POST',
				body: '{}',
				headers: { origin: 'https://evil.example' },
			}),
			routeContext('/v1/invoices'),
		)

		expect(response.status).toBe(403)
		expect(resolveFieldCourseboardPrincipalMock).not.toHaveBeenCalled()
	})

	it('allows only the explicit Tauri origin and headers during preflight', async () => {
		const response = await OPTIONS(
			new Request('https://courseboard.example/field-api/v1/invoices', {
				method: 'OPTIONS',
				headers: {
					origin: 'tauri://localhost',
					'access-control-request-method': 'PATCH',
					'access-control-request-headers':
						'authorization, content-type, x-operator-id, x-platform-id',
				},
			}),
		)

		expect(response.status).toBe(204)
		expect(response.headers.get('access-control-allow-origin')).toBe(
			'tauri://localhost',
		)
	})
})
