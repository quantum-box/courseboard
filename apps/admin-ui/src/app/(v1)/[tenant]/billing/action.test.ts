import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('app/auth', () => ({
	authWithCheck: vi.fn().mockResolvedValue({ accessToken: 'access-token' }),
}))

vi.mock('lib/serverBackendUrl', () => ({
	getServerBackendBaseUrl: () => 'https://tachyon-field-api.test',
	joinServerBackendPath: (path: string) =>
		`https://tachyon-field-api.test${path.startsWith('/') ? path : `/${path}`}`,
}))

vi.mock('lib/runtime-env', () => ({
	getRuntimeEnv: (name: string) =>
		name === 'NEXT_PUBLIC_PLATFORM_ID' ? 'tn_platform' : undefined,
}))

function jsonResponse(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: vi.fn().mockResolvedValue(body),
		text: vi.fn().mockResolvedValue(JSON.stringify(body)),
	} as unknown as Response
}

describe('Billing center actions', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	})

	it('resends payment links through the runtime field API base URL', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse(200, { id: 'inv_1' }))
		vi.stubGlobal('fetch', fetchMock)

		const { resendPaymentLinkAction } = await import('./action')
		const result = await resendPaymentLinkAction('tn_operator', 'inv_1')

		expect(result.success).toBe(true)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/invoices/inv_1/payment-link/resend',
			expect.objectContaining({
				body: JSON.stringify({
					paymentLinkProvider: 'stripe',
					sendEmail: true,
				}),
				headers: expect.objectContaining({
					Authorization: 'Bearer access-token',
					'x-operator-id': 'tn_operator',
					'x-platform-id': 'tn_platform',
				}),
				method: 'POST',
			}),
		)
	})

	it('returns backend status and message when resending payment links fails', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse(503, {
				provider_error: 'SES account is paused',
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const { resendPaymentLinkAction } = await import('./action')
		const result = await resendPaymentLinkAction('tn_operator', 'inv_1')

		expect(result.success).toBe(false)
		expect(result.statusCode).toBe(503)
		expect(result.message).toContain('HTTP 503')
		expect(result.message).toContain('SES account is paused')
	})

	it('updates follow-up status with the selected status and note', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse(200, { id: 'inv_1' }))
		vi.stubGlobal('fetch', fetchMock)

		const { updateFollowUpStatusAction } = await import('./action')
		const result = await updateFollowUpStatusAction(
			'tn_operator',
			'inv_1',
			'payment_promised',
			'called from billing center',
		)

		expect(result.success).toBe(true)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/invoices/inv_1/follow-up-status',
			expect.objectContaining({
				body: JSON.stringify({
					status: 'payment_promised',
					note: 'called from billing center',
				}),
				method: 'POST',
			}),
		)
	})

	it('derives collection queue actions and canonical drilldown links', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/v1/invoices?status=Sent')) {
				return jsonResponse(200, {
					items: [
						{
							id: 'inv_no_link',
							invoiceNumber: 'INV-NO-LINK',
							clientId: 'client_1',
							clientName: 'No Link Client',
							status: 'Sent',
							currency: 'JPY',
							totalAmount: 1000,
							dueDate: '2026-05-01',
							paymentLinkUrl: null,
							notes: null,
							updatedAt: '2026-05-02T00:00:00Z',
							createdAt: '2026-05-01T00:00:00Z',
						},
						{
							id: 'inv_with_link',
							invoiceNumber: 'INV-LINK',
							clientId: 'client_2',
							clientName: 'Link Client',
							status: 'Sent',
							currency: 'JPY',
							totalAmount: 2000,
							dueDate: '2026-05-03',
							paymentLinkUrl: 'https://pay.example/inv_with_link',
							notes:
								'[billing-follow-up status=contacted actor=us_1 at=2026-05-02T00:00:00Z]',
							updatedAt: '2026-05-03T00:00:00Z',
							createdAt: '2026-05-01T00:00:00Z',
						},
					],
				})
			}
			if (url.includes('/v1/invoices?status=Overdue')) {
				return jsonResponse(200, { items: [] })
			}
			if (url.includes('/v1/invoices?status=Draft')) {
				return jsonResponse(200, { items: [] })
			}
			if (url.includes('/v1/erp/ar-ap/summary')) {
				return jsonResponse(200, {
					receivableOutstanding: 500,
					receivableOverdue: 500,
					payableOutstanding: 0,
					payableOverdue: 0,
				})
			}
			if (url.includes('/v1/erp/ar-ap/items')) {
				return jsonResponse(200, {
					items: [
						{
							id: 'arap_1',
							kind: 'receivable',
							sourceType: 'invoice',
							sourceId: 'inv_with_link',
							sourceNumber: 'INV-LINK',
							counterpartyName: 'Link Client',
							dueDate: '2026-05-01',
							currency: 'JPY',
							totalAmount: 2000,
							settledAmount: 1500,
							outstandingAmount: 500,
							effectiveStatus: 'partially_settled',
							daysOverdue: 2,
						},
					],
				})
			}
			if (url.includes('/v1/invoice-reconciliations/square-payments')) {
				return jsonResponse(200, {
					items: [
						{
							id: 'sq_1',
							squarePaymentId: 'sqpay_1',
							amount: 3000,
							currency: 'JPY',
							payerHint: 'Square payer',
							receivedAt: '2026-05-02T00:00:00Z',
							status: 'Unmatched',
						},
					],
				})
			}
			return jsonResponse(404, { message: `unexpected url ${url}` })
		})
		vi.stubGlobal('fetch', fetchMock)

		const { fetchBillingCenterAction } = await import('./action')
		const result = await fetchBillingCenterAction('tn_operator')

		expect(result.success).toBe(true)
		const queue = result.data?.queue ?? []
		const invoiceWithoutLink = queue.find(
			item => item.id === 'invoice-inv_no_link',
		)
		const invoiceWithLink = queue.find(
			item => item.id === 'invoice-inv_with_link',
		)
		const arItem = queue.find(item => item.id === 'ar-arap_1')
		const squareItem = queue.find(item => item.id === 'square-sq_1')

		expect(invoiceWithoutLink?.canResendPaymentLink).toBe(false)
		expect(invoiceWithLink?.canResendPaymentLink).toBe(true)
		expect(invoiceWithLink?.followUpStatus).toBe('contacted')
		expect(invoiceWithLink?.reconciliationHref).toBe(
			'/accounting/revenue-reconciliation?sourceId=inv_with_link&sourceType=invoice',
		)
		expect(arItem?.kind).toBe('partially_paid')
		expect(arItem?.canResendPaymentLink).toBe(false)
		expect(arItem?.reconciliationHref).toBe('/erp/ar-ap?itemId=arap_1')
		expect(squareItem?.href).toBe(
			'/accounting/revenue-reconciliation?sourceId=sqpay_1&sourceType=square_payment',
		)
	})
})
