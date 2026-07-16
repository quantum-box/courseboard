import type { Session } from 'next-auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPERATOR_IDS, PLATFORM_IDS } from './mode'
import fetchTenants, {
	FIELD_ADMIN_TENANT_ACCESS_ACTION,
	TenantFetchPartialError,
	clearTenantFetcherCacheForTests,
	getPartialTenantFetchTenants,
} from './tenantFetcher'

vi.mock('./serverBackendUrl', () => ({
	getServerBackendBaseUrl: () => 'https://field.test',
}))

const session = {
	accessToken: 'access-token',
} as Session

const tenantListUrl = `https://field.test/get_tenants?required_action=${encodeURIComponent(FIELD_ADMIN_TENANT_ACCESS_ACTION)}`

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

describe('fetchTenants', () => {
	afterEach(() => {
		clearTenantFetcherCacheForTests()
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	})

	it('fetches all accessible tenants with platform and operator auth headers', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse(200, [
					{
						id: OPERATOR_IDS.production,
						name: 'Production',
						platformId: PLATFORM_IDS.production,
					},
					{
						id: 'tn_child_production',
						name: 'Child Production',
						platformId: OPERATOR_IDS.production,
					},
					{
						id: 'tn_other',
						name: 'Other App',
						platformId: 'tn_other_platform',
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
		vi.stubGlobal('fetch', fetchMock)

		await expect(fetchTenants(session)).resolves.toEqual([
			{
				id: OPERATOR_IDS.production,
				name: 'Production',
				mode: 'production',
				platformId: PLATFORM_IDS.production,
			},
			{
				id: 'tn_child_production',
				name: 'Child Production',
				mode: 'production',
				platformId: OPERATOR_IDS.production,
			},
			{
				id: 'tn_other',
				name: 'Other App',
				mode: 'production',
				platformId: 'tn_other_platform',
			},
			{
				id: OPERATOR_IDS.sandbox,
				name: 'Sandbox',
				mode: 'sandbox',
				platformId: PLATFORM_IDS.sandbox,
			},
		])

		expect(fetchMock).toHaveBeenCalledWith(
			tenantListUrl,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer access-token',
					'x-platform-id': PLATFORM_IDS.production,
					'x-operator-id': OPERATOR_IDS.production,
				}),
			}),
		)
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			tenantListUrl,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer access-token',
					'x-platform-id': PLATFORM_IDS.sandbox,
					'x-operator-id': OPERATOR_IDS.sandbox,
				}),
			}),
		)
	})

	it('deduplicates tenants returned through multiple known parents', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
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
							id: OPERATOR_IDS.production,
							name: 'Production Duplicate',
							platformId: OPERATOR_IDS.production,
						},
					]),
				),
		)

		await expect(fetchTenants(session)).resolves.toEqual([
			{
				id: OPERATOR_IDS.production,
				name: 'Production',
				mode: 'production',
				platformId: PLATFORM_IDS.production,
			},
		])
	})

	it('reuses the tenant list for repeated requests with the same access token', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse(200, [
					{
						id: 'tn_child_production',
						name: 'Child Production',
						platformId: OPERATOR_IDS.production,
					},
				]),
			)
			.mockResolvedValueOnce(jsonResponse(200, []))
		vi.stubGlobal('fetch', fetchMock)

		await expect(fetchTenants(session)).resolves.toEqual([
			{
				id: 'tn_child_production',
				name: 'Child Production',
				mode: 'production',
				platformId: OPERATOR_IDS.production,
			},
		])
		await expect(fetchTenants(session)).resolves.toEqual([
			{
				id: 'tn_child_production',
				name: 'Child Production',
				mode: 'production',
				platformId: OPERATOR_IDS.production,
			},
		])

		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('rejects authorization failures', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(403, { message: 'forbidden' }))
				.mockResolvedValueOnce(jsonResponse(403, { message: 'forbidden' })),
		)

		await expect(fetchTenants(session)).rejects.toThrow(
			'Failed to fetch tenants: 403 forbidden',
		)
	})

	it('refreshes the session and retries when tenant fetch returns 401', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(401, { message: 'unauthorized' }))
			.mockResolvedValueOnce(jsonResponse(401, { message: 'unauthorized' }))
			.mockResolvedValueOnce(
				jsonResponse(200, [{ id: 'tn_production', name: 'Production' }]),
			)
			.mockResolvedValueOnce(jsonResponse(200, []))
		vi.stubGlobal('fetch', fetchMock)

		const refreshSession = vi.fn().mockResolvedValue({
			accessToken: 'refreshed-access-token',
		} as Session)

		await expect(fetchTenants(session, { refreshSession })).resolves.toEqual([
			{
				id: 'tn_production',
				name: 'Production',
				mode: 'production',
			},
		])

		expect(refreshSession).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			tenantListUrl,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer refreshed-access-token',
					'x-platform-id': PLATFORM_IDS.production,
					'x-operator-id': OPERATOR_IDS.production,
				}),
			}),
		)
	})

	it('rejects unexpected server failures', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
				.mockResolvedValueOnce(jsonResponse(500, { message: 'boom' })),
		)

		await expect(fetchTenants(session)).rejects.toThrow(
			'Failed to fetch tenants: 500 boom',
		)
	})

	it('preserves tenants fetched from healthy platforms when another platform fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(
					jsonResponse(200, [
						{
							id: 'tn_child_production',
							name: 'Child Production',
							platformId: OPERATOR_IDS.production,
						},
					]),
				)
				.mockResolvedValueOnce(
					jsonResponse(502, { message: 'Bad Gateway' }, 'Bad Gateway'),
				),
		)

		const error = await fetchTenants(session).then(
			() => null,
			error => error,
		)

		expect(error).toBeInstanceOf(TenantFetchPartialError)
		expect(error).toHaveProperty(
			'message',
			'Failed to fetch tenants: 502 Bad Gateway',
		)
		expect(getPartialTenantFetchTenants(error)).toEqual([
			{
				id: 'tn_child_production',
				name: 'Child Production',
				mode: 'production',
				platformId: OPERATOR_IDS.production,
			},
		])
	})
})
