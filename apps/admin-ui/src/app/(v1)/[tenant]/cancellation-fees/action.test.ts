import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
	authWithCheck: vi.fn(),
	verifyAccessToken: vi.fn(),
}))

const navigationMocks = vi.hoisted(() => ({
	redirect: vi.fn(),
}))

vi.mock('app/auth', () => ({
	authWithCheck: authMocks.authWithCheck,
	verifyAccessToken: authMocks.verifyAccessToken,
}))

vi.mock('next/cache', () => ({
	revalidatePath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
	redirect: navigationMocks.redirect,
}))

function validCancellationFeeFormData() {
	const formData = new FormData()
	formData.set('amount', '1000')
	formData.set('sendSms', 'on')
	formData.set('clientPhone', '+819012345678')
	formData.set('smsConsentConfirmed', 'on')
	formData.set('dueDate', '2026-07-31')
	formData.set('clientName', 'Test Customer')
	return formData
}

function createdInvoice() {
	return Response.json({ id: 'inv_test', status: 'Draft' }, { status: 201 })
}

function fulfilledSmsInvoice(overrides: Record<string, unknown> = {}) {
	return Response.json({
		id: 'inv_test',
		status: 'Sent',
		paymentLinkUrl: 'https://tachyon-field.test/pay/inv_test',
		paymentLinkStatus: 'Ready',
		smsDeliveryStatus: 'Sent',
		...overrides,
	})
}

describe('createCancellationFeeAction auth delegation', () => {
	beforeEach(() => {
		vi.resetModules()
		vi.unstubAllEnvs()
		vi.clearAllMocks()
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.test')
		vi.stubEnv('NEXT_PUBLIC_PLATFORM_ID', 'tn_platform')
		authMocks.authWithCheck.mockResolvedValue({ accessToken: 'user-access-token' })
		authMocks.verifyAccessToken.mockResolvedValue({
			user: { id: 'us_test', role: 'OWNER', tenants: ['tn_operator'] },
		})
	})

	it('verifies the session user token before creating the cancellation fee invoice', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(createdInvoice())
			.mockResolvedValueOnce(fulfilledSmsInvoice())
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(authMocks.verifyAccessToken).toHaveBeenCalledWith('user-access-token')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/invoices',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer user-access-token',
					'x-operator-id': 'tn_operator',
					'x-platform-id': 'tn_platform',
				}),
				method: 'POST',
			}),
		)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/invoices/inv_test/fulfill',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer user-access-token',
					'x-operator-id': 'tn_operator',
					'x-platform-id': 'tn_platform',
				}),
				method: 'POST',
			}),
		)
	})

	it('does not create a double-slash Field API path when the runtime base URL has a trailing slash', async () => {
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.test/')
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(createdInvoice())
			.mockResolvedValueOnce(fulfilledSmsInvoice())
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/invoices',
			expect.any(Object),
		)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/invoices/inv_test/fulfill',
			expect.any(Object),
		)
		expect(navigationMocks.redirect).toHaveBeenCalledWith(
			'/tn_operator/invoices/inv_test',
		)
		expect(result).toBeUndefined()
	})

	it('does not send a legacy static public API key to the Field API', async () => {
		authMocks.authWithCheck.mockResolvedValue({ accessToken: 'pk_static_test' })
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(authMocks.verifyAccessToken).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(result.status).toBe('error')
	})

	it('does not call the Field API when the session has no user token', async () => {
		authMocks.authWithCheck.mockResolvedValue({})
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(authMocks.verifyAccessToken).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(result.status).toBe('error')
	})

	it('does not call the Field API when token verification fails', async () => {
		authMocks.verifyAccessToken.mockRejectedValue(new Error('verify failed'))
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(fetchMock).not.toHaveBeenCalled()
		expect(result.status).toBe('error')
	})

	it('returns the backend status and error body instead of falling through the error boundary', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json(
				{ message: 'SMS provider billing is not enabled' },
				{ status: 503 },
			),
		)
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(result).toMatchObject({
			status: 'error',
			statusCode: 503,
		})
		expect(result.message).toContain('HTTP 503')
		expect(result.message).toContain('SMS provider billing is not enabled')
	})

	it('keeps the created invoice visible when fulfillment fails upstream', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(createdInvoice())
			.mockResolvedValueOnce(
				Response.json({ message: 'notification unavailable' }, { status: 503 }),
			)
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(result).toMatchObject({
			status: 'delivery_error',
			invoiceId: 'inv_test',
			statusCode: 503,
		})
		expect(result.message).toContain('notification unavailable')
		expect(navigationMocks.redirect).not.toHaveBeenCalled()
	})

	it('does not report success when fulfillment returns no issued payment link', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(createdInvoice())
			.mockResolvedValueOnce(
				fulfilledSmsInvoice({
					paymentLinkUrl: null,
					paymentLinkStatus: 'Pending',
				}),
			)
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(result).toMatchObject({
			status: 'delivery_error',
			invoiceId: 'inv_test',
		})
		expect(result.message).toContain('支払いリンクが発行されていません')
		expect(navigationMocks.redirect).not.toHaveBeenCalled()
	})

	it('does not report success while the selected delivery is incomplete', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(createdInvoice())
			.mockResolvedValueOnce(
				fulfilledSmsInvoice({
					status: 'Draft',
					smsDeliveryStatus: 'Pending',
				}),
			)
		vi.stubGlobal('fetch', fetchMock)

		const { createCancellationFeeAction } = await import('./action')
		const result = await createCancellationFeeAction(
			'tn_operator',
			{ status: 'idle' },
			validCancellationFeeFormData(),
		)

		expect(result).toMatchObject({
			status: 'delivery_error',
			invoiceId: 'inv_test',
		})
		expect(result.message).toContain('送信が完了していません')
		expect(navigationMocks.redirect).not.toHaveBeenCalled()
	})
})
