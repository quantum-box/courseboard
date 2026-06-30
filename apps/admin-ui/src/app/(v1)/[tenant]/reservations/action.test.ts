import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ReservationActions = typeof import('./action')

const authMocks = vi.hoisted(() => ({
	authWithCheck: vi.fn(),
}))

const reliableFetchMocks = vi.hoisted(() => ({
	fetchJsonWithRetry: vi.fn(),
	fetchWithRetry: vi.fn(),
}))

vi.mock('app/auth', () => ({
	authWithCheck: authMocks.authWithCheck,
}))

vi.mock('lib/reliable-fetch', () => ({
	fetchJsonWithRetry: reliableFetchMocks.fetchJsonWithRetry,
	fetchWithRetry: reliableFetchMocks.fetchWithRetry,
}))

vi.mock('next/cache', () => ({
	revalidatePath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
	redirect: vi.fn(),
}))

vi.mock('lib/cloud-app-extensions', () => ({
	fetchCloudAppExtensions: vi.fn(),
}))

function backendFailure(status: number, message = 'Forbidden') {
	return {
		ok: false as const,
		error: {
			kind: status === 403 ? 'forbidden' : 'server_error',
			status,
			message,
			retryable: status >= 500,
			attempts: 1,
			body: message,
		},
	}
}

function formData(values: Record<string, string> = {}) {
	const data = new FormData()
	for (const [key, value] of Object.entries(values)) {
		data.set(key, value)
	}
	return data
}

describe('reservation mutation actions', () => {
	beforeEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.test')
		vi.stubEnv('NEXT_PUBLIC_PLATFORM_ID', 'tn_platform')
		authMocks.authWithCheck.mockResolvedValue({ accessToken: 'user-token' })
	})

	it('returns an inline 403 state for cancellation instead of throwing to error.tsx', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		reliableFetchMocks.fetchWithRetry.mockResolvedValue(
			backendFailure(403, 'Forbidden'),
		)

		const { cancelReservationWithPolicyAction } = await import('./action')
		const result = await cancelReservationWithPolicyAction(
			'tn_operator',
			'rs_test',
			formData({ reason: 'operator cancellation' }),
		)

		expect(result).toMatchObject({
			status: 'error',
			statusCode: 403,
			message: 'この操作に必要な権限/スコープが不足しています',
		})
		expect(result.message).not.toContain('Forbidden')
		expect(reliableFetchMocks.fetchWithRetry).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				onNonOkResponse: expect.any(Function),
			}),
		)
		const onNonOkResponse =
			reliableFetchMocks.fetchWithRetry.mock.calls[0][1].onNonOkResponse
		onNonOkResponse({
			body: `Forbidden ${'x'.repeat(200)}`,
			headers: new Headers({ 'cf-ray': 'ray-test' }),
			status: 403,
			url: 'https://tachyon-field-api.test/v1/erp/reservations/rs_test/cancel',
		})
		expect(warnSpy).toHaveBeenCalledWith('field_api_mutation_non_ok', {
			status: 403,
			host: 'tachyon-field-api.test',
			cfRay: 'ray-test',
			bodyPreview: `Forbidden ${'x'.repeat(110)}`,
		})
		warnSpy.mockRestore()
	})

	it('returns an inline 500 state for cancellation instead of exposing backend text', async () => {
		reliableFetchMocks.fetchWithRetry.mockResolvedValue(
			backendFailure(500, 'provider exploded'),
		)

		const { cancelReservationWithPolicyAction } = await import('./action')
		const result = await cancelReservationWithPolicyAction(
			'tn_operator',
			'rs_test',
			formData(),
		)

		expect(result).toMatchObject({
			status: 'error',
			statusCode: 500,
			message: '一時的に利用できません。時間をおいて再試行してください',
		})
		expect(result.message).not.toContain('provider exploded')
	})

	it.each([
		[
			'status update',
			async (actions: ReservationActions) =>
				actions.updateReservationStatusAction(
					'tn_operator',
					'rs_test',
					'confirmed',
				),
		],
		[
			'staff update',
			async (actions: ReservationActions) =>
				actions.updateReservationStaffAction(
					'tn_operator',
					'rs_test',
					formData({ assignedStaffIds: 'staff_1' }),
				),
		],
		[
			'billing link',
			async (actions: ReservationActions) =>
				actions.issueReservationBillingLinkAction('tn_operator', 'rs_test'),
		],
		[
			'expired holds release',
			async (actions: ReservationActions) =>
				actions.releaseExpiredReservationHoldsAction('tn_operator'),
		],
		[
			'notification settings save',
			async (actions: ReservationActions) =>
				actions.saveReservationNotificationSettingsAction(
					'tn_operator',
					formData({
						'confirmation.enabled': 'on',
						'confirmation.subject': '確認',
						'confirmation.body': '本文',
						'reminder.subject': '前日',
						'reminder.body': '本文',
						'change_cancellation.enabled': 'on',
						'change_cancellation.subject': '変更',
						'change_cancellation.body': '本文',
					}),
				),
		],
	] as const)(
		'returns an inline state for %s backend failures',
		async (_label, runAction) => {
			reliableFetchMocks.fetchWithRetry.mockResolvedValue(
				backendFailure(403, 'Forbidden'),
			)

			const actions = await import('./action')
			const result = await runAction(actions)

			expect(result).toMatchObject({
				status: 'error',
				statusCode: 403,
				message: 'この操作に必要な権限/スコープが不足しています',
			})
			expect(result.message).not.toContain('Forbidden')
		},
	)

	it('returns an inline state for invoice issue failures', async () => {
		reliableFetchMocks.fetchJsonWithRetry.mockResolvedValue(
			backendFailure(500, 'raw provider failure'),
		)

		const { issueReservationSquareInvoiceAction } = await import('./action')
		const result = await issueReservationSquareInvoiceAction(
			'tn_operator',
			'rs_test',
		)

		expect(result).toMatchObject({
			status: 'error',
			statusCode: 500,
			message: '一時的に利用できません。時間をおいて再試行してください',
		})
		expect(result.message).not.toContain('raw provider failure')
	})

	it('returns an inline state for notification send failures', async () => {
		reliableFetchMocks.fetchJsonWithRetry.mockResolvedValue({
			ok: true,
			data: { configJson: { confirmation: { enabled: true } } },
			response: new Response('{}'),
			attempts: 1,
		})
		reliableFetchMocks.fetchWithRetry.mockResolvedValue(
			backendFailure(403, 'Forbidden'),
		)

		const { sendReservationNotificationAction } = await import('./action')
		const result = await sendReservationNotificationAction(
			'tn_operator',
			'rs_test',
			'confirmation',
			null,
		)

		expect(result).toMatchObject({
			status: 'error',
			statusCode: 403,
			message: 'この操作に必要な権限/スコープが不足しています',
		})
		expect(result.message).not.toContain('Forbidden')
	})

	it('keeps reservation server actions from throwing into the route error boundary', () => {
		const source = readFileSync(new URL('./action.ts', import.meta.url), 'utf8')

		expect(source).not.toMatch(/throw\s+new\s+Error/)
	})
})
