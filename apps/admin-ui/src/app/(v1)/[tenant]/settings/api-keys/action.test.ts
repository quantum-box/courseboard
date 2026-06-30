import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('app/auth', () => ({
	authWithCheck: vi.fn().mockResolvedValue({ accessToken: 'access-token' }),
}))

describe('API key actions', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	})

	it('normalizes API key list responses from the field API', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				api_keys: [
					{
						id: 'key_1',
						name: 'Payments',
						key_prefix: 'tf_live',
						use_cases: ['field_public_payment'],
						scopes: ['field_public_payment'],
						created_at: '2026-06-18T00:00:00Z',
						last_used_at: null,
						revoked_at: null,
					},
					{
						id: 'key_2',
						name: 'Legacy',
						key_prefix: 'tf_old',
						scopes: ['field_public_checkout'],
						created_at: '2026-06-17T00:00:00Z',
						last_used_at: '2026-06-18T00:00:00Z',
						revoked_at: '2026-06-18T01:00:00Z',
					},
				],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)
		vi.stubEnv('TACHYON_FIELD_API_URL', 'http://tachyon-field-api:50056/')

		const { fetchApiKeysAction } = await import('./action')
		const result = await fetchApiKeysAction('tn_operator')

		expect(result).toEqual({
			success: true,
			data: [
				{
					id: 'key_1',
					name: 'Payments',
					key_prefix: 'tf_live',
					use_cases: ['field_public_payment'],
					scopes: ['field_public_payment'],
					created_at: '2026-06-18T00:00:00Z',
					last_used_at: null,
					revoked_at: null,
					status: 'active',
				},
				{
					id: 'key_2',
					name: 'Legacy',
					key_prefix: 'tf_old',
					use_cases: ['field_public_checkout'],
					scopes: ['field_public_checkout'],
					created_at: '2026-06-17T00:00:00Z',
					last_used_at: '2026-06-18T00:00:00Z',
					revoked_at: '2026-06-18T01:00:00Z',
					status: 'revoked',
				},
			],
		})
		expect(fetchMock).toHaveBeenCalledWith(
			'http://tachyon-field-api:50056/v1/field/api-keys',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer access-token',
					'Content-Type': 'application/json',
					'x-operator-id': 'tn_operator',
				}),
			}),
		)
	})

	it('returns operator-safe messages for HTTP failures while logging details', async () => {
		const errorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('upstream detail', { status: 500 })),
		)

		const { createApiKeyAction } = await import('./action')
		const result = await createApiKeyAction('tn_operator', 'Payments', [
			'field_public_payment',
		])

		expect(result).toEqual({
			success: false,
			message: 'APIキーの作成に失敗しました',
		})
		expect(errorSpy).toHaveBeenCalledWith(
			'Failed to create API key:',
			'upstream detail',
		)
	})
})
