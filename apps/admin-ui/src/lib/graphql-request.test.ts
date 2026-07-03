import { describe, expect, it, vi } from 'vitest'
import { GraphQLClient } from './graphql-request'
import { fetchWithRetry } from './reliable-fetch'

vi.mock('./reliable-fetch', () => ({
	fetchWithRetry: vi.fn(),
	ReliableFetchError: class ReliableFetchError extends Error {},
}))

const fetchWithRetryMock = vi.mocked(fetchWithRetry)

describe('GraphQLClient', () => {
	it('applies async header resolution before sending the request', async () => {
		fetchWithRetryMock.mockResolvedValueOnce({
			ok: true,
			attempts: 1,
			response: {
				ok: true,
				json: vi.fn().mockResolvedValue({ data: { ok: true } }),
			} as unknown as Response,
		})
		const client = new GraphQLClient('https://field.test/v1/graphql', {
			headers: {
				'x-platform-id': 'tn_platform',
				'x-operator-id': 'tenant-slug',
			},
			resolveHeaders: async headers => ({
				...headers,
				'x-operator-id': 'tn_01j91h09tpj5ehwbwfwfxpak2b',
			}),
		})

		await expect(client.request('{ me { id } }')).resolves.toEqual({ ok: true })

		expect(fetchWithRetryMock).toHaveBeenCalledWith(
			'https://field.test/v1/graphql',
			expect.objectContaining({
				headers: expect.objectContaining({
					'x-platform-id': 'tn_platform',
					'x-operator-id': 'tn_01j91h09tpj5ehwbwfwfxpak2b',
				}),
			}),
		)
	})
})
