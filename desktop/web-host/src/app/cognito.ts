import { getRuntimeEnv } from 'lib/runtime-env'
import type { JWT } from 'next-auth/jwt'

type CognitoAuthenticationResult = {
	AccessToken?: string
	ExpiresIn?: number
	IdToken?: string
	RefreshToken?: string
}

type CognitoGetTokensFromRefreshTokenResponse = {
	AuthenticationResult?: CognitoAuthenticationResult
}

type CognitoErrorResponse = {
	__type?: string
	code?: string
	message?: string
	Message?: string
}

class CognitoServiceError extends Error {
	constructor(name: string, message: string) {
		super(message)
		this.name = name
	}
}

function normalizeCognitoErrorType(value: unknown) {
	if (typeof value !== 'string' || !value) {
		return undefined
	}
	const withoutNamespace = value.split('#').pop() ?? value
	const withoutMetadata = withoutNamespace.split(':')[0] ?? withoutNamespace
	return withoutMetadata.split('.').pop() ?? withoutMetadata
}

async function readCognitoJson(response: Response) {
	return (await response.json().catch(() => ({}))) as Record<string, unknown>
}

async function sendCognitoRequest<TResponse>(
	region: string,
	operation: 'GetTokensFromRefreshToken',
	body: Record<string, unknown>,
): Promise<TResponse> {
	const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
		body: JSON.stringify(body),
		headers: {
			'content-type': 'application/x-amz-json-1.1',
			'x-amz-target': `AWSCognitoIdentityProviderService.${operation}`,
		},
		method: 'POST',
	})
	const payload = await readCognitoJson(response)
	if (!response.ok) {
		const errorPayload = payload as CognitoErrorResponse
		const name =
			normalizeCognitoErrorType(errorPayload.__type) ??
			normalizeCognitoErrorType(errorPayload.code) ??
			`CognitoHttp${response.status}`
		throw new CognitoServiceError(
			name,
			errorPayload.message ?? errorPayload.Message ?? 'Cognito request failed',
		)
	}
	return payload as TResponse
}

export async function cognitoRefreshAccessToken(token: JWT): Promise<JWT> {
	try {
		if (!token.refreshToken) {
			throw new Error('No refresh token available')
		}

		const client_id = getRuntimeEnv('COGNITO_CLIENT_ID') ?? ''
		const client_secret = getRuntimeEnv('COGNITO_CLIENT_SECRET') ?? ''
		const region = getRuntimeEnv('COGNITO_REGION')

		if (!client_id || !region) {
			throw new Error('Cognito refresh authentication is not configured')
		}

		try {
			const refreshInput: {
				RefreshToken: string
				ClientId: string
				ClientSecret?: string
			} = {
				RefreshToken: token.refreshToken,
				ClientId: client_id,
			}
			if (client_secret) {
				refreshInput.ClientSecret = client_secret
			}
			const response =
				await sendCognitoRequest<CognitoGetTokensFromRefreshTokenResponse>(
					region,
					'GetTokensFromRefreshToken',
					refreshInput,
				)

			if (!response.AuthenticationResult) {
				throw new Error('No authentication result')
			}

			const { AccessToken, ExpiresIn, IdToken } = response.AuthenticationResult

			if (!AccessToken) {
				throw new Error('No access token')
			}

			return {
				...token,
				accessToken: AccessToken,
				idToken: IdToken ?? token.idToken,
				refreshToken:
					response.AuthenticationResult.RefreshToken ?? token.refreshToken,
				error: undefined,
				errorDetail: undefined,
				expires_at: Math.floor(Date.now() / 1000 + (ExpiresIn || 60 * 60)),
			}
		} catch (cognitoError) {
			console.error('Cognito refresh token error:', cognitoError)
			return {
				...token,
				error: 'RefreshAccessTokenError',
				errorDetail:
					cognitoError instanceof Error
						? cognitoError.message
						: 'Unknown error',
			}
		}
	} catch (error) {
		console.error('Error refreshing access token:', error)
		return { ...token, error: 'RefreshAccessTokenError' as const }
	}
}
