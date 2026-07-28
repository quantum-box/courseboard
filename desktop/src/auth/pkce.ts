import { i18next } from '../i18n'

const PKCE_VERIFIER_BYTES = 64

export const NATIVE_AUTH_PENDING_KEY = 'courseboard.auth.native.pending'
export const NATIVE_AUTH_PENDING_MAX_AGE_MS = 10 * 60 * 1000

export type PkceTransaction = {
  state: string
  verifier: string
  challenge: string
  redirectUri: string
  createdAt: number
}

export class NativeAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NativeAuthorizationError'
  }
}

function randomBase64Url(byteLength: number) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new NativeAuthorizationError('安全な乱数生成器を利用できません。')
  }
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function sameRedirectTarget(actual: URL, expected: URL) {
  return actual.protocol === expected.protocol
    && actual.username === expected.username
    && actual.password === expected.password
    && actual.hostname === expected.hostname
    && actual.port === expected.port
    && actual.pathname === expected.pathname
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export async function createPkceTransaction(
  redirectUri: string,
  createdAt = Date.now(),
): Promise<PkceTransaction> {
  if (!globalThis.crypto?.subtle) {
    throw new NativeAuthorizationError('PKCEを生成するWeb Crypto APIを利用できません。')
  }
  const verifier = randomBase64Url(PKCE_VERIFIER_BYTES)
  const state = randomBase64Url(32)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return {
    state,
    verifier,
    challenge: bytesToBase64Url(new Uint8Array(digest)),
    redirectUri,
    createdAt,
  }
}

export function parseAuthorizationCallback(
  callbackUrl: string,
  transaction: Pick<PkceTransaction, 'state' | 'redirectUri' | 'createdAt'>,
  now = Date.now(),
) {
  let callback: URL
  let expected: URL
  try {
    callback = new URL(callbackUrl)
    expected = new URL(transaction.redirectUri)
  } catch {
    throw new NativeAuthorizationError('認証callback URLが不正です。')
  }

  if (!sameRedirectTarget(callback, expected)) {
    throw new NativeAuthorizationError('登録されていない認証callbackを拒否しました。')
  }
  if (now < transaction.createdAt || now - transaction.createdAt > NATIVE_AUTH_PENDING_MAX_AGE_MS) {
    throw new NativeAuthorizationError(i18next.t('auth:error.requestExpired'))
  }

  const returnedState = callback.searchParams.get('state')
  if (!returnedState || !constantTimeEqual(returnedState, transaction.state)) {
    throw new NativeAuthorizationError('ログイン要求のstateが一致しません。')
  }

  const authorizationError = callback.searchParams.get('error')
  if (authorizationError) {
    const description = callback.searchParams.get('error_description')
    throw new NativeAuthorizationError(
      description ? `ログインが拒否されました: ${description}` : `ログインが拒否されました: ${authorizationError}`,
    )
  }

  const code = callback.searchParams.get('code')
  if (!code) throw new NativeAuthorizationError('認証codeがcallbackに含まれていません。')
  return code
}
