import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CognitoRequestError,
  authenticateWithCognito,
  refreshCognitoTokens,
} from './cognito'

const endpoint = 'https://cognito-idp.ap-northeast-1.amazonaws.com/'
const clientId = 'public-client-id'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Cognito direct authentication', () => {
  it('authenticates with USER_PASSWORD_AUTH and no client secret', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      AuthenticationResult: {
        AccessToken: 'access-token',
        IdToken: 'id-token',
        RefreshToken: 'refresh-token',
        ExpiresIn: 3600,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await authenticateWithCognito(
      endpoint,
      clientId,
      'user@example.com',
      'password',
    )

    expect(result).toEqual({
      status: 'authenticated',
      tokens: {
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      },
    })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: {
        USERNAME: 'user@example.com',
        PASSWORD: 'password',
      },
    })
    expect(JSON.stringify(body)).not.toContain('SECRET_HASH')
  })

  it('refreshes with Cognito and preserves the existing refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      AuthenticationResult: {
        AccessToken: 'new-access-token',
        IdToken: 'new-id-token',
        ExpiresIn: 1800,
      },
    })))

    const tokens = await refreshCognitoTokens(endpoint, clientId, 'refresh-token')

    expect(tokens).toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'refresh-token',
      expiresIn: 1800,
    })
  })

  it('classifies provider 4xx as definitive without exposing raw details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      __type: 'NotAuthorizedException',
      message: 'raw account state',
    }, { status: 400 })))

    const error = await authenticateWithCognito(endpoint, clientId, 'user', 'bad')
      .catch(reason => reason)

    expect(error).toBeInstanceOf(CognitoRequestError)
    expect(error.definitive).toBe(true)
    expect(error.message).not.toContain('raw account state')
  })
})
