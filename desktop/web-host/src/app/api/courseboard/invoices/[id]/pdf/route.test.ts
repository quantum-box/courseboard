import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	buildDocumentPdf: vi.fn(),
	getDocumentPdfSettings: vi.fn(),
	loadCourseboardTenants: vi.fn(),
	resolveFieldCourseboardPrincipal: vi.fn(),
}))

vi.mock('lib/courseboard-auth-context', () => ({
	loadCourseboardTenants: mocks.loadCourseboardTenants,
	resolveFieldCourseboardPrincipal: mocks.resolveFieldCourseboardPrincipal,
}))
vi.mock('lib/document-pdf', () => ({
	buildDocumentPdf: mocks.buildDocumentPdf,
}))
vi.mock('lib/document-pdf-settings', () => ({
	getDocumentPdfSettings: mocks.getDocumentPdfSettings,
	isDocumentPdfTemplate: (value: string | undefined) =>
		['simple', 'detailed', 'japanese'].includes(value ?? ''),
	resolveDocumentPdfTemplate: (
		value: string | undefined,
		fallback: string,
	) => value ?? fallback,
}))
vi.mock('lib/auth-url', () => ({
	resolveAuthUrl: (request: Request) => new URL(request.url).origin,
}))
vi.mock('lib/serverBackendUrl', () => ({
	joinServerBackendPath: (path: string) => `https://field.example${path}`,
}))

import { GET, OPTIONS } from './route'

const principal = {
	source: 'web-session',
	session: { accessToken: 'stale-web-token', user: { id: 'us_1' } },
}
const authorizedSession = {
	accessToken: 'canonical-token',
	user: { id: 'us_1' },
}
const allowedTenant = {
	id: 'tn_allowed',
	name: 'Allowed',
	mode: 'production',
}
const invoice = {
	id: 'inv_test',
	tenantId: 'tn_allowed',
	invoiceNumber: 'INV-TEST',
	clientId: 'client_test',
	clientName: 'Example Customer',
	clientEmail: 'customer@example.com',
	lineItems: [
		{
			description: 'キャンセル料',
			quantity: 1,
			unitPrice: 1000,
			amount: 1000,
		},
	],
	dueDate: '2026-07-31',
	status: 'Sent',
	currency: 'JPY',
	subtotalAmount: 1000,
	taxAmount: 100,
	totalAmount: 1100,
	createdAt: '2026-07-12T00:00:00Z',
	updatedAt: '2026-07-12T00:00:00Z',
}

function request(
	query = '',
	headers: Record<string, string> = {},
) {
	return new Request(
		`https://courseboard.example/api/courseboard/invoices/inv_test/pdf${query}`,
		{
			headers: {
				'x-operator-id': 'tn_allowed',
				...headers,
			},
		},
	)
}

const context = { params: { id: 'inv_test' } }

describe('GET /api/courseboard/invoices/:id/pdf', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.resolveFieldCourseboardPrincipal.mockResolvedValue(principal)
		mocks.loadCourseboardTenants.mockResolvedValue({
			kind: 'ok',
			session: authorizedSession,
			tenants: [allowedTenant],
			partial: false,
		})
		mocks.getDocumentPdfSettings.mockResolvedValue({
			defaultTemplate: 'simple',
			includeSealByDefault: true,
		})
		mocks.buildDocumentPdf.mockResolvedValue(
			new TextEncoder().encode('%PDF-test'),
		)
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(Response.json(invoice)),
		)
	})

	it('returns 401 without a Web session or valid Native bearer', async () => {
		mocks.resolveFieldCourseboardPrincipal.mockResolvedValue(undefined)
		const fetchMock = vi.mocked(fetch)

		const response = await GET(request(), context)

		expect(response.status).toBe(401)
		expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
		expect(mocks.loadCourseboardTenants).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('returns 403 without leaking an upstream request for another tenant', async () => {
		mocks.loadCourseboardTenants.mockResolvedValue({
			kind: 'ok',
			session: authorizedSession,
			tenants: [{ ...allowedTenant, id: 'tn_other' }],
			partial: false,
		})
		const fetchMock = vi.mocked(fetch)

		const response = await GET(
			request('', { origin: 'tauri://localhost' }),
			context,
		)

		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' })
		expect(response.headers.get('x-courseboard-auth-denial')).toBe('tenant')
		expect(response.headers.get('access-control-expose-headers')).toContain(
			'X-Courseboard-Auth-Denial',
		)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('uses 503 rather than a false denial when tenant results are partial', async () => {
		mocks.loadCourseboardTenants.mockResolvedValue({
			kind: 'ok',
			session: authorizedSession,
			tenants: [{ ...allowedTenant, id: 'tn_other' }],
			partial: true,
		})

		const response = await GET(request(), context)

		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({
			code: 'TENANT_DIRECTORY_PARTIAL',
		})
	})

	it('maps an upstream failure to a safe 502 without reflecting its body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response('Bearer secret-token internal failure', {
					status: 500,
				}),
			),
		)

		const response = await GET(request(), context)
		const body = await response.text()

		expect(response.status).toBe(502)
		expect(body).toContain('INVOICE_API_FAILED')
		expect(body).not.toContain('secret-token')
	})

	it('accepts an authenticated Web session without requiring a bearer header', async () => {
		const response = await GET(request(), context)

		expect(response.status).toBe(200)
		expect(mocks.resolveFieldCourseboardPrincipal).toHaveBeenCalledWith(
			expect.any(Request),
		)
		expect(response.headers.get('access-control-allow-origin')).toBeNull()
	})

	it('binds Web or Native auth to the authoritative tenant and returns a CORS PDF', async () => {
		const nativePrincipal = {
			source: 'bearer',
			session: { accessToken: 'native-client-token', user: { id: 'us_native' } },
		}
		mocks.resolveFieldCourseboardPrincipal.mockResolvedValue(nativePrincipal)
		const response = await GET(
			request(
				'?template=japanese&seal=0&preview=1&download=cancel-fee.pdf',
				{
					authorization: 'Bearer native-client-token',
					origin: 'tauri://localhost',
					'x-platform-id': 'tn_spoofed-platform',
				},
			),
			context,
		)

		expect(response.status).toBe(200)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new TextEncoder().encode('%PDF-test'),
		)
		expect(response.headers.get('content-type')).toBe('application/pdf')
		expect(response.headers.get('content-disposition')).toBe(
			'inline; filename="cancel-fee.pdf"',
		)
		expect(response.headers.get('access-control-allow-origin')).toBe(
			'tauri://localhost',
		)
		expect(response.headers.get('access-control-expose-headers')).toContain(
			'Content-Disposition',
		)

		const fetchMock = vi.mocked(fetch)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://field.example/v1/invoices/inv_test')
		const headers = init.headers as Record<string, string>
		expect(headers.authorization).toBe('Bearer canonical-token')
		expect(headers['x-operator-id']).toBe('tn_allowed')
		expect(headers['x-platform-id']).toBe(
			'tn_01hjjn348rn3t49zz6hvmfq67p',
		)
		expect(mocks.getDocumentPdfSettings).toHaveBeenCalledWith(
			'tn_allowed',
			'canonical-token',
			'tn_01hjjn348rn3t49zz6hvmfq67p',
		)
		expect(mocks.buildDocumentPdf).toHaveBeenCalledWith(
			expect.objectContaining({ documentNumber: 'INV-TEST' }),
			'https://courseboard.example',
			expect.objectContaining({ template: 'japanese', includeSeal: false }),
		)
	})

	it('rejects caller-controlled tenant query scope before authentication', async () => {
		const fetchMock = vi.mocked(fetch)

		const response = await GET(request('?tenant=tn_other'), context)

		expect(response.status).toBe(400)
		expect(mocks.resolveFieldCourseboardPrincipal).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('supports a narrow Tauri GET preflight', async () => {
		const response = await OPTIONS(
			request('', {
				origin: 'http://tauri.localhost',
				'access-control-request-method': 'GET',
				'access-control-request-headers':
					'authorization, accept, x-operator-id',
			}),
		)

		expect(response.status).toBe(204)
		expect(response.headers.get('access-control-allow-origin')).toBe(
			'http://tauri.localhost',
		)
	})
})
