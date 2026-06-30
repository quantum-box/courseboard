import { describe, expect, it, vi } from 'vitest'
import { classifyHttpFailure, fetchJsonWithRetry } from './reliable-fetch'

describe('reliable fetch', () => {
	it('does not retry authorization failures', async () => {
		const onNonOkResponse = vi.fn()
		const fetcher = vi.fn(
			async () =>
				new Response('missing scope', {
					status: 403,
					headers: { 'cf-ray': 'ray-test' },
				}),
		)

		const result = await fetchJsonWithRetry<{ ok: boolean }>(
			'https://example.test',
			{
				fetcher,
				backoffMs: 0,
				onNonOkResponse,
			},
		)

		expect(fetcher).toHaveBeenCalledTimes(1)
		expect(onNonOkResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				attempt: 1,
				body: 'missing scope',
				status: 403,
				url: 'https://example.test',
			}),
		)
		expect(onNonOkResponse.mock.calls[0][0].headers.get('cf-ray')).toBe(
			'ray-test',
		)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.kind).toBe('forbidden')
			expect(result.error.retryable).toBe(false)
			expect(result.error.message).toContain('権限')
		}
	})

	it('retries transient server failures before returning JSON', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response('upstream timeout', { status: 502 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)

		const result = await fetchJsonWithRetry<{ ok: boolean }>(
			'https://example.test',
			{
				fetcher,
				backoffMs: 0,
			},
		)

		expect(fetcher).toHaveBeenCalledTimes(2)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data).toEqual({ ok: true })
			expect(result.attempts).toBe(2)
		}
	})

	it('returns invalid_response when a successful response is not JSON', async () => {
		const fetcher = vi.fn(async () => new Response('not-json', { status: 200 }))

		const result = await fetchJsonWithRetry<{ ok: boolean }>(
			'https://example.test',
			{
				fetcher,
				backoffMs: 0,
			},
		)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.kind).toBe('invalid_response')
			expect(result.error.retryable).toBe(false)
		}
	})

	it('classifies rate limits as retryable', () => {
		const failure = classifyHttpFailure(429, 'too many requests', 1)

		expect(failure.kind).toBe('rate_limited')
		expect(failure.retryable).toBe(true)
		expect(failure.message).toContain('レート制限')
	})
})
