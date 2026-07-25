const INITIATE_AUTH_TARGET = 'AWSCognitoIdentityProviderService.InitiateAuth'

type CognitoAuthenticationResult = {
  AccessToken?: string
  IdToken?: string
  RefreshToken?: string
  ExpiresIn?: number
}

type CognitoResponse = {
  AuthenticationResult?: CognitoAuthenticationResult
  ChallengeName?: string
  __type?: string
}

export type CognitoTokens = {
  accessToken: string
  idToken: string
  refreshToken?: string
  expiresIn: number
}

export type CognitoPasswordResult =
  | { status: 'authenticated'; tokens: CognitoTokens }
  | { status: 'new_password_required' }

export class CognitoRequestError extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
    readonly code = 'unknown',
  ) {
    super(message)
    this.name = 'CognitoRequestError'
  }
}

export async function authenticateWithCognito(
  endpoint: string,
  clientId: string,
  username: string,
  password: string,
): Promise<CognitoPasswordResult> {
  const response = await cognitoRequest(endpoint, {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  })
  if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    return { status: 'new_password_required' }
  }
  return {
    status: 'authenticated',
    tokens: normalizeTokens(response.AuthenticationResult, true),
  }
}

export async function refreshCognitoTokens(
  endpoint: string,
  clientId: string,
  refreshToken: string,
): Promise<CognitoTokens> {
  const response = await cognitoRequest(endpoint, {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  })
  return {
    ...normalizeTokens(response.AuthenticationResult, false),
    refreshToken: response.AuthenticationResult?.RefreshToken ?? refreshToken,
  }
}

async function cognitoRequest(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<CognitoResponse> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': INITIATE_AUTH_TARGET,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new CognitoRequestError('Cognitoへ接続できませんでした。', false)
  }

  const payload = await response.json().catch(() => ({})) as CognitoResponse
  if (!response.ok) {
    const definitive = response.status >= 400 && response.status < 500
    const code = payload.__type?.split('#').pop() ?? `HTTP_${response.status}`
    const message = cognitoErrorMessage(code, definitive)
    throw new CognitoRequestError(
      `${message} (${code})`,
      definitive,
      code,
    )
  }
  return payload
}

function cognitoErrorMessage(code: string, definitive: boolean) {
  if (code === 'NotAuthorizedException' || code === 'UserNotFoundException') {
    return 'ユーザー名、パスワード、またはアカウント状態を確認してください。'
  }
  if (code === 'UserNotConfirmedException') {
    return 'ユーザー確認が完了していません。'
  }
  if (code === 'PasswordResetRequiredException') {
    return 'パスワードの再設定が必要です。'
  }
  if (code === 'InvalidParameterException') {
    return 'Cognito public clientの認証設定が不正です。'
  }
  if (code === 'TooManyRequestsException') {
    return 'ログイン試行が多すぎます。少し待ってから再試行してください。'
  }
  return definitive
    ? 'Cognitoがログインを拒否しました。'
    : '認証サービスで一時的な問題が発生しました。'
}

function normalizeTokens(
  result: CognitoAuthenticationResult | undefined,
  requireRefreshToken: boolean,
): CognitoTokens {
  if (!result?.AccessToken || !result.IdToken) {
    throw new CognitoRequestError('Cognitoから必要なtokenが返りませんでした。', true)
  }
  if (requireRefreshToken && !result.RefreshToken) {
    throw new CognitoRequestError('Cognitoからrefresh tokenが返りませんでした。', true)
  }
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn ?? 3600,
  }
}
