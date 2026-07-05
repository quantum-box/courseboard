import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

describe('field-api subrequest smoke route', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('returns 200 only when the Worker subrequest reaches field-api health', async () => {
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.txcloud.app')
		const fetchMock = vi.fn().mockResolvedValue(
			new Response('OK', {
				status: 200,
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const response = await GET()

		expect(response.status).toBe(200)
		expect(fetchMock).toHaveBeenCalledWith(
			new URL('https://tachyon-field-api.txcloud.app/health'),
			expect.objectContaining({
				headers: expect.objectContaining({
					'User-Agent': 'courseboard-field-api-subrequest-smoke',
				}),
			}),
		)
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			check: 'courseboard_field_api_subrequest',
			upstream: {
				origin: 'https://tachyon-field-api.txcloud.app',
				path: '/health',
				status: 200,
			},
		})
	})

	it('fails the smoke when the Worker subrequest receives a 522', async () => {
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.txcloud.app')
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 522 })))

		const response = await GET()

		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			upstream: {
				origin: 'https://tachyon-field-api.txcloud.app',
				path: '/health',
				status: 522,
			},
		})
	})
})
