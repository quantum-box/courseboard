import type { Session } from 'next-auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLATFORM_IDS } from './mode'
import { getServerGraphqlSdk } from './serverGraphqlClient'

const runtimeGlobal = globalThis as typeof globalThis & {
	__env__?: Record<string, string | undefined>
}

describe('getServerGraphqlSdk', () => {
	afterEach(() => {
		runtimeGlobal.__env__ = undefined
		vi.unstubAllGlobals()
	})

	it('uses the runtime Field API binding for SSR GraphQL requests', async () => {
		runtimeGlobal.__env__ = {
			TACHYON_FIELD_API_URL: 'https://internal-field-api.example.test/',
		}
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						products: {
							items: [],
							pageInfo: { hasNextPage: false, limit: 100, offset: 0 },
							totalCount: 0,
						},
					},
				}),
				{
					headers: { 'content-type': 'application/json' },
					status: 200,
				},
			),
		)
		vi.stubGlobal('fetch', fetchMock)

		const tenantId = 'tn_test'
		const session = { accessToken: 'test-access-token' } as Session
		const sdk = getServerGraphqlSdk(session, tenantId)

		await sdk.getProuctsForAdmin({ limit: 100, offset: 0 })

		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://internal-field-api.example.test/v1/graphql')
		expect(init.method).toBe('POST')
		expect(init.headers).toMatchObject({
			Authorization: 'Bearer test-access-token',
			'content-type': 'application/json',
			'x-operator-id': tenantId,
			'x-platform-id': PLATFORM_IDS.production,
		})

		const body = JSON.parse(String(init.body)) as {
			query: string
			variables: Record<string, unknown>
		}
		expect(body.query).toContain('query getProuctsForAdmin')
		expect(body.variables).toEqual({ limit: 100, offset: 0 })
	})
})
