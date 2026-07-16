import type { JWT } from 'next-auth/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cognitoRefreshAccessToken } from './cognito'

function token(overrides: Partial<JWT> = {}): JWT {
	return {
		accessToken: 'old-access-token',
		expires_at: 0,
		refreshToken: 'refresh-token',
		user: {
			email: 'operator@example.com',
			id: 'user_1',
			role: 'OWNER',
			username: 'operator',
		},
		...overrides,
	} as JWT
}

function stubCognitoEnv(clientSecret = 'client-secret') {
	vi.stubEnv('COGNITO_CLIENT_ID', 'client-id')
	vi.stubEnv('COGNITO_CLIENT_SECRET', clientSecret)
	vi.stubEnv('COGNITO_REGION', 'ap-northeast-1')
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe('cognitoRefreshAccessToken', () => {
	it('refreshes with the Cognito JSON API and stores rotated refresh tokens', async () => {
		stubCognitoEnv()
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					AuthenticationResult: {
						AccessToken: 'new-access-token',
						ExpiresIn: 120,
						IdToken: 'new-id-token',
						RefreshToken: 'rotated-refresh-token',
					},
				}),
				{ status: 200 },
			),
		)
		vi.stubGlobal('fetch', fetchMock)

		const refreshed = await cognitoRefreshAccessToken(token())

		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://cognito-idp.ap-northeast-1.amazonaws.com/')
		expect(init.method).toBe('POST')
		expect(init.headers).toMatchObject({
			'content-type': 'application/x-amz-json-1.1',
			'x-amz-target':
				'AWSCognitoIdentityProviderService.GetTokensFromRefreshToken',
		})
		expect(JSON.parse(String(init.body))).toMatchObject({
			ClientId: 'client-id',
			ClientSecret: 'client-secret',
			RefreshToken: 'refresh-token',
		})
		expect(refreshed.accessToken).toBe('new-access-token')
		expect(refreshed.idToken).toBe('new-id-token')
		expect(refreshed.refreshToken).toBe('rotated-refresh-token')
		expect(refreshed.error).toBeUndefined()
	})

	it('omits ClientSecret for public clients and preserves the original refresh token', async () => {
		stubCognitoEnv('')
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						AuthenticationResult: {
							AccessToken: 'new-access-token',
							ExpiresIn: 120,
						},
					}),
					{ status: 200 },
				),
			),
		)

		const refreshed = await cognitoRefreshAccessToken(token())

		const fetchMock = vi.mocked(fetch)
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(JSON.parse(String(init.body))).toEqual({
			ClientId: 'client-id',
			RefreshToken: 'refresh-token',
		})
		expect(refreshed.refreshToken).toBe('refresh-token')
		expect(refreshed.error).toBeUndefined()
	})
})
