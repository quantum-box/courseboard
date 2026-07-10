import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { authMock } = vi.hoisted(() => ({
	authMock: vi.fn(),
}))

vi.mock('app/auth', () => ({
	auth: authMock,
}))

const fetchMock = vi.fn()

function request(
	body: unknown,
	headers: Record<string, string> = {
		'x-operator-id': 'tn_01ks18jhh1xvggktfzjx5jqsen',
		'x-platform-id': 'tn_01ks18jhh1xvggktfzjx5jqsen',
	},
) {
	return new Request('https://courseboard.txcloud.app/api/graphql', {
		body: JSON.stringify(body),
		headers: {
			'content-type': 'application/json',
			// urql's default Accept — must NOT be forwarded upstream (PLT-2501:
			// the public edge rejects Accept: text/event-stream with 501).
			accept:
				'application/graphql-response+json, application/graphql+json, application/json, text/event-stream, multipart/mixed',
			authorization: 'Bearer client-supplied-token',
			...headers,
		},
		method: 'POST',
	})
}

describe('POST /api/graphql', () => {
	beforeEach(() => {
		authMock.mockReset()
		fetchMock.mockReset()
		vi.stubGlobal('fetch', fetchMock)
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://field-api.internal.example')
		authMock.mockResolvedValue({ accessToken: 'server-session-token' })
		fetchMock.mockResolvedValue(
			new Response('{"data":{"__typename":"Mutation"}}', {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
	})

	it('forwards the body to the server-side Field API URL', async () => {
		const body = {
			query: 'mutation createProduct { createProduct { id } }',
			variables: { input: { name: 'p' } },
		}
		const response = await POST(request(body))

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			data: { __typename: 'Mutation' },
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('https://field-api.internal.example/v1/graphql')
		expect(init.method).toBe('POST')
		expect(JSON.parse(init.body)).toEqual(body)
	})

	it('sends a JSON-only Accept upstream (never text/event-stream)', async () => {
		await POST(request({ query: '{__typename}' }))

		const [, init] = fetchMock.mock.calls[0]
		expect(init.headers.accept).not.toContain('text/event-stream')
		expect(init.headers.accept).not.toContain('multipart/mixed')
		expect(init.headers.accept).toContain('application/json')
	})

	it('uses the server session token, not the client Authorization header', async () => {
		await POST(request({ query: '{__typename}' }))

		const [, init] = fetchMock.mock.calls[0]
		expect(init.headers.authorization).toBe('Bearer server-session-token')
	})

	it('forwards tenant scoping headers', async () => {
		await POST(request({ query: '{__typename}' }))

		const [, init] = fetchMock.mock.calls[0]
		expect(init.headers['x-operator-id']).toBe(
			'tn_01ks18jhh1xvggktfzjx5jqsen',
		)
		expect(init.headers['x-platform-id']).toBe(
			'tn_01ks18jhh1xvggktfzjx5jqsen',
		)
	})

	it('rejects malformed tenant headers', async () => {
		const response = await POST(
			request({ query: '{__typename}' }, { 'x-operator-id': 'bad value\n' }),
		)

		expect(response.status).toBe(400)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('returns 401 when there is no session', async () => {
		authMock.mockResolvedValue(null)

		const response = await POST(request({ query: '{__typename}' }))

		expect(response.status).toBe(401)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('returns 401 when the session token is stale', async () => {
		authMock.mockResolvedValue({
			accessToken: 'token',
			error: 'RefreshAccessTokenError',
		})

		const response = await POST(request({ query: '{__typename}' }))

		expect(response.status).toBe(401)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('passes through upstream error statuses', async () => {
		fetchMock.mockResolvedValue(
			new Response('{"errors":[{"message":"boom"}]}', {
				status: 503,
				headers: { 'content-type': 'application/json' },
			}),
		)

		const response = await POST(request({ query: '{__typename}' }))

		expect(response.status).toBe(503)
	})

	it('maps upstream fetch failures to 502', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'))

		const response = await POST(request({ query: '{__typename}' }))

		expect(response.status).toBe(502)
		const payload = (await response.json()) as {
			errors: Array<{ message: string }>
		}
		expect(payload.errors[0]?.message).toContain('TACHYON Field API')
	})
})
