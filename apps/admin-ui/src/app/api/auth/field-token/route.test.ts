import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { authMock, refreshAuthSessionMock, verifyAccessTokenMock } = vi.hoisted(
	() => ({
		authMock: vi.fn(),
		refreshAuthSessionMock: vi.fn(),
		verifyAccessTokenMock: vi.fn(),
	}),
)

vi.mock('app/auth', () => ({
	auth: authMock,
	refreshAuthSession: refreshAuthSessionMock,
	verifyAccessToken: verifyAccessTokenMock,
}))

function request(body: unknown) {
	return new Request('https://courseboard.txcloud.app/api/auth/field-token', {
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	})
}

describe('POST /api/auth/field-token', () => {
	beforeEach(() => {
		authMock.mockReset()
		refreshAuthSessionMock.mockReset()
		verifyAccessTokenMock.mockReset()
		verifyAccessTokenMock.mockResolvedValue({ user: { id: 'us_1' } })
	})

	it('reads the access token through the canonical auth session path', async () => {
		authMock.mockResolvedValue({ accessToken: 'user-token' })

		const response = await POST(request({ force: false }))

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ accessToken: 'user-token' })
		expect(authMock).toHaveBeenCalledTimes(1)
		expect(refreshAuthSessionMock).not.toHaveBeenCalled()
		expect(verifyAccessTokenMock).toHaveBeenCalledWith('user-token')
	})

	it('uses the canonical refresh path when forced', async () => {
		refreshAuthSessionMock.mockResolvedValue({ accessToken: 'fresh-token' })

		const response = await POST(request({ force: true }))

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ accessToken: 'fresh-token' })
		expect(authMock).not.toHaveBeenCalled()
		expect(refreshAuthSessionMock).toHaveBeenCalledTimes(1)
		expect(verifyAccessTokenMock).toHaveBeenCalledWith('fresh-token')
	})

	it('returns unauthorized when the canonical session is missing', async () => {
		authMock.mockResolvedValue(null)

		const response = await POST(request({ force: false }))

		expect(response.status).toBe(401)
		expect(verifyAccessTokenMock).not.toHaveBeenCalled()
	})
})
