import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	buildDocumentPdf: vi.fn(),
	getDocumentPdfSettings: vi.fn(),
}))

vi.mock('app/auth', () => ({ auth: mocks.auth }))
vi.mock('lib/document-pdf', () => ({
	buildDocumentPdf: mocks.buildDocumentPdf,
}))
vi.mock('lib/document-pdf-settings', () => ({
	getDocumentPdfSettings: mocks.getDocumentPdfSettings,
	resolveDocumentPdfTemplate: (
		value: string | null | undefined,
		fallback: string,
	) => value ?? fallback,
}))

import { GET } from './route'

const invoice = {
	id: 'inv_test',
	tenantId: 'tn_test',
	invoiceNumber: 'INV-TEST',
	clientId: 'client_test',
	lineItems: [
		{
			description: 'キャンセル料',
			quantity: 1,
			unitPrice: 1000,
			amount: 1000,
		},
	],
	dueDate: '2026-07-31',
	status: 'Draft',
	currency: 'JPY',
	subtotalAmount: 1000,
	taxAmount: 0,
	totalAmount: 1000,
	createdAt: '2026-07-12T00:00:00Z',
	updatedAt: '2026-07-12T00:00:00Z',
}

describe('invoice PDF route', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.stubEnv('CF_PAGES_URL', 'https://stale--courseboard.txcloud.app')
		mocks.auth.mockResolvedValue({ accessToken: 'access_test' })
		mocks.getDocumentPdfSettings.mockResolvedValue({
			defaultTemplate: 'simple',
			includeSealByDefault: true,
		})
		mocks.buildDocumentPdf.mockResolvedValue(
			new TextEncoder().encode('%PDF-test'),
		)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json(invoice)),
		)
	})

	it('loads PDF assets from the current request origin', async () => {
		const request = new Request(
			'https://pr2512--courseboard.txcloud.app/tn_test/invoices/inv_test/pdf?preview=1',
			{
				headers: {
					host: 'pr2512--courseboard.txcloud.app',
					'x-forwarded-host': 'pr2512--courseboard.txcloud.app',
					'x-forwarded-proto': 'https',
				},
			},
		)

		const response = await GET(request, {
			params: { tenant: 'tn_test', id: 'inv_test' },
		})

		expect(response.status).toBe(200)
		expect(mocks.buildDocumentPdf).toHaveBeenCalledWith(
			expect.objectContaining({ documentNumber: 'INV-TEST' }),
			'https://pr2512--courseboard.txcloud.app',
			expect.objectContaining({ template: 'simple' }),
		)
	})
})
