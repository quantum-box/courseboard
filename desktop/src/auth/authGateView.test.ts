import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginBoot,
  clearLastReadySession,
  hasRestorableBrowserSession,
  readLastReadySession,
  resolveAuthGateView,
  sessionExpiredNotice,
  sessionVerifyingNotice,
  writeLastReadySession,
} from './authGateView'
import type { AuthState } from './types'

const user = { id: 'u1', name: 'Operator', role: 'ADMIN' }
const tenant = {
  id: 't1',
  name: 'Course',
  mode: 'production' as const,
  platformId: 'p1',
  operatorId: 'o1',
}

function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(() => {
      store.clear()
    }),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
})

afterEach(() => {
  clearLastReadySession()
  vi.unstubAllGlobals()
})

describe('resolveAuthGateView', () => {
  it('keeps the app shell while revalidating a known session', () => {
    const state: AuthState = {
      status: 'booting',
      previous: { user, tenant },
    }
    expect(resolveAuthGateView(state)).toEqual({ kind: 'hold-app' })
  })

  it('keeps the app shell when a restorable session hint exists', () => {
    expect(resolveAuthGateView({ status: 'booting', restorable: true })).toEqual({
      kind: 'hold-app',
    })
  })

  it('uses a minimal boot state for cold start without a session hint', () => {
    expect(resolveAuthGateView({ status: 'booting' })).toEqual({ kind: 'boot' })
  })

  it('never uses a full-screen verifying takeover for bootstrap', () => {
    expect(resolveAuthGateView({ status: 'booting' }).kind).not.toBe('loading')
    expect(resolveAuthGateView({
      status: 'booting',
      previous: { user, tenant },
    }).kind).not.toBe('loading')
    expect(resolveAuthGateView({ status: 'booting', restorable: true }).kind).not.toBe('loading')
  })

  it('does not treat in-flight bootstrap as signed out', () => {
    expect(resolveAuthGateView({ status: 'booting' }).kind).not.toBe('sign-in')
    expect(resolveAuthGateView({
      status: 'booting',
      previous: { user, tenant },
    }).kind).not.toBe('sign-in')
  })

  it('shows sign-in only after anonymous is confirmed', () => {
    expect(resolveAuthGateView({ status: 'anonymous' })).toEqual({ kind: 'sign-in' })
    expect(resolveAuthGateView({ status: 'anonymous', reason: 'expired' })).toEqual({
      kind: 'sign-in',
      reason: 'expired',
    })
    expect(resolveAuthGateView({ status: 'anonymous', reason: 'logout' })).toEqual({
      kind: 'sign-in',
      reason: 'logout',
    })
  })

  it('renders the app when ready', () => {
    expect(resolveAuthGateView({ status: 'ready', user, tenant })).toEqual({ kind: 'app' })
  })

  it('uses neutral loading while authorizing', () => {
    expect(resolveAuthGateView({ status: 'authorizing' })).toEqual({
      kind: 'loading',
      authorizing: true,
    })
  })
})

describe('sessionVerifyingNotice', () => {
  it('returns a toast only while revalidating a known or restorable session', () => {
    expect(sessionVerifyingNotice({
      status: 'booting',
      previous: { user, tenant },
    })).toBe('Verifying session…')
    expect(sessionVerifyingNotice({ status: 'booting', restorable: true }))
      .toBe('Verifying session…')
    expect(sessionVerifyingNotice({ status: 'booting' })).toBeUndefined()
    expect(sessionVerifyingNotice({ status: 'ready', user, tenant })).toBeUndefined()
    expect(sessionVerifyingNotice({ status: 'anonymous' })).toBeUndefined()
  })
})

describe('beginBoot', () => {
  it('keeps the previous ready session while revalidating', () => {
    expect(beginBoot({ status: 'ready', user, tenant })).toEqual({
      next: { status: 'booting', previous: { user, tenant } },
      holdingSession: true,
    })
  })

  it('restores a persisted snapshot on cold boot', () => {
    expect(beginBoot(
      { status: 'booting' },
      { snapshot: { user, tenant }, restorable: true },
    )).toEqual({
      next: {
        status: 'booting',
        previous: { user, tenant },
        restorable: true,
      },
      holdingSession: true,
    })
  })

  it('holds the shell for a restorable token without a snapshot', () => {
    expect(beginBoot({ status: 'anonymous' }, { restorable: true })).toEqual({
      next: { status: 'booting', restorable: true },
      holdingSession: true,
    })
  })

  it('starts a cold boot without a held session', () => {
    expect(beginBoot({ status: 'anonymous' })).toEqual({
      next: { status: 'booting' },
      holdingSession: false,
    })
  })
})

describe('sessionExpiredNotice', () => {
  it('returns a toast message only for expired sessions', () => {
    expect(sessionExpiredNotice('expired')).toBe('Your session expired. Please sign in again.')
    expect(sessionExpiredNotice('logout')).toBeUndefined()
    expect(sessionExpiredNotice(undefined)).toBeUndefined()
  })
})

describe('ready session snapshot', () => {
  it('persists and clears the last ready session', () => {
    writeLastReadySession(user, tenant)
    expect(readLastReadySession()).toEqual({ user, tenant })
    clearLastReadySession()
    expect(readLastReadySession()).toBeUndefined()
  })
})

describe('hasRestorableBrowserSession', () => {
  it('detects durable browser-pkce tokens', () => {
    expect(hasRestorableBrowserSession()).toBe(false)
    localStorage.setItem('courseboard.auth.browser.session', JSON.stringify({
      accessToken: 'token',
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 60_000,
    }))
    expect(hasRestorableBrowserSession()).toBe(true)
  })

  it('detects a legacy refresh token in sessionStorage', () => {
    sessionStorage.setItem('courseboard.auth.browser.refresh', 'legacy-refresh')
    expect(hasRestorableBrowserSession()).toBe(true)
  })
})
