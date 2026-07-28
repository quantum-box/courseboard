import { describe, expect, it } from 'vitest'
import {
  NATIVE_AUTH_PENDING_MAX_AGE_MS,
  NativeAuthorizationError,
  createPkceTransaction,
  parseAuthorizationCallback,
} from './pkce'

describe('native OAuth PKCE', () => {
  it('generates RFC 7636 compatible verifier, challenge, and state', async () => {
    const transaction = await createPkceTransaction('courseboard://oauth/callback', 1_000)

    expect(transaction.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(transaction.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(transaction.createdAt).toBe(1_000)
  })

  it('accepts an exact redirect target and matching state', () => {
    const transaction = {
      state: 'expected-state',
      redirectUri: 'courseboard://oauth/callback',
      createdAt: 1_000,
    }
    const code = parseAuthorizationCallback(
      'courseboard://oauth/callback?code=authorization-code&state=expected-state',
      transaction,
      2_000,
    )

    expect(code).toBe('authorization-code')
  })

  it('rejects state mismatch, redirect mismatch, and expired requests', () => {
    const transaction = {
      state: 'expected-state',
      redirectUri: 'courseboard://oauth/callback',
      createdAt: 1_000,
    }

    expect(() => parseAuthorizationCallback(
      'courseboard://oauth/callback?code=code&state=wrong-state',
      transaction,
      2_000,
    )).toThrow(NativeAuthorizationError)
    expect(() => parseAuthorizationCallback(
      'courseboard://attacker/callback?code=code&state=expected-state',
      transaction,
      2_000,
    )).toThrow('登録されていない認証callback')
    expect(() => parseAuthorizationCallback(
      'courseboard://oauth/callback?code=code&state=expected-state',
      transaction,
      1_000 + NATIVE_AUTH_PENDING_MAX_AGE_MS + 1,
    )).toThrow('受付時間が過ぎました')
  })
})
