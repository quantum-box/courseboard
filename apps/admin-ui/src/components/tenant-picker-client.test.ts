import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPERATOR_IDS, PLATFORM_IDS } from 'lib/mode'
import {
	BrowserTenantFetchError,
	fetchTenantsFromBrowser,
} from './tenant-picker-client'

function jsonResponse(
	status: number,
	body: unknown,
	statusText = '',
): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		json: vi.fn().mockResolvedValue(body),
	} as unknown as Response
}

describe('fetchTenantsFromBrowser', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('binds the browser fetch implementation when no fetch override is provided', async () => {
		let call = 0
		const browserWindow = {
			fetch: vi
				.fn(function (this: unknown) {
					if (this !== browserWindow) {
						throw new TypeError('Illegal invocation')
					}
					call += 1
					if (call === 1) {
						return Promise.resolve(
							jsonResponse(200, { accessToken: 'user-token' }),
						)
					}
					if (call === 2) {
						return Promise.resolve(
							jsonResponse(200, [
								{
									id: OPERATOR_IDS.production,
									name: 'Production',
									platformId: PLATFORM_IDS.production,
								},
							]),
						)
					}
					return Promise.resolve(jsonResponse(403, { message: 'forbidden' }))
				}) as unknown as typeof fetch,
		}
		vi.stubGlobal('window', browserWindow)

		await expect(
			fetchTenantsFromBrowser({
				backendBaseUrl: 'https://tachyon-field-api.test',
			}),
		).resolves.toEqual([
			{
				id: OPERATOR_IDS.production,
				name: 'Production',
				mode: 'production',
				platformId: PLATFORM_IDS.production,
			},
		])

		expect(browserWindow.fetch).toHaveBeenCalledTimes(3)
	})

	it('uses the browser session token endpoint and fetches tenants directly from field-api', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'user-token' }))
			.mockResolvedValueOnce(
				jsonResponse(200, [
					{
						id: OPERATOR_IDS.production,
						name: 'Production',
						platformId: PLATFORM_IDS.production,
					},
				]),
			)
			.mockResolvedValueOnce(
				jsonResponse(200, [
					{
						id: OPERATOR_IDS.sandbox,
						name: 'Sandbox',
						platformId: PLATFORM_IDS.sandbox,
					},
				]),
			)

		await expect(
			fetchTenantsFromBrowser({
				backendBaseUrl: 'https://tachyon-field-api.test',
				fetchImpl: fetchMock as unknown as typeof fetch,
			}),
		).resolves.toEqual([
			{
				id: OPERATOR_IDS.production,
				name: 'Production',
				mode: 'production',
				platformId: PLATFORM_IDS.production,
			},
			{
				id: OPERATOR_IDS.sandbox,
				name: 'Sandbox',
				mode: 'sandbox',
				platformId: PLATFORM_IDS.sandbox,
			},
		])

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			'/api/auth/field-token',
			expect.objectContaining({
				body: JSON.stringify({ force: false }),
				method: 'POST',
			}),
		)
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			`https://tachyon-field-api.test/get_tenants?required_action=${encodeURIComponent('field:ViewSalesAnalytics')}`,
			expect.objectContaining({
				cache: 'no-store',
				headers: expect.objectContaining({
					Authorization: 'Bearer user-token',
					'x-operator-id': OPERATOR_IDS.production,
					'x-platform-id': PLATFORM_IDS.production,
				}),
				method: 'POST',
			}),
		)
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			`https://tachyon-field-api.test/get_tenants?required_action=${encodeURIComponent('field:ViewSalesAnalytics')}`,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer user-token',
					'x-operator-id': OPERATOR_IDS.sandbox,
					'x-platform-id': PLATFORM_IDS.sandbox,
				}),
			}),
		)
	})

	it('refreshes the user bearer once when field-api returns 401', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse(200, { accessToken: 'expired-token' }),
			)
			.mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
			.mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
			.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh-token' }))
			.mockResolvedValueOnce(
				jsonResponse(200, [
					{
						id: OPERATOR_IDS.production,
						name: 'Production',
						platformId: PLATFORM_IDS.production,
					},
				]),
			)
			.mockResolvedValueOnce(jsonResponse(403, { message: 'forbidden' }))

		await expect(
			fetchTenantsFromBrowser({
				backendBaseUrl: 'https://tachyon-field-api.test',
				fetchImpl: fetchMock as unknown as typeof fetch,
			}),
		).resolves.toEqual([
			{
				id: OPERATOR_IDS.production,
				name: 'Production',
				mode: 'production',
				platformId: PLATFORM_IDS.production,
			},
		])

		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			'/api/auth/field-token',
			expect.objectContaining({
				body: JSON.stringify({ force: true }),
				method: 'POST',
			}),
		)
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer fresh-token',
				}),
			}),
		)
	})

	it('fails without exposing a static fallback when the session token endpoint is unavailable', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(401, { message: 'unauthorized' }))

		await expect(
			fetchTenantsFromBrowser({
				backendBaseUrl: 'https://tachyon-field-api.test',
				fetchImpl: fetchMock as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({
			status: 401,
		} satisfies Partial<BrowserTenantFetchError>)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/auth/field-token',
			expect.objectContaining({
				body: JSON.stringify({ force: false }),
			}),
		)
	})
})
