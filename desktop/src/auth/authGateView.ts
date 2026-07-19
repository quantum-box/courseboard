import type { AuthReason, AuthState, AuthTenant, AuthUser } from './types'

/** Keep in sync with `BROWSER_PKCE_SESSION_KEY` in adapters.ts */
const BROWSER_PKCE_SESSION_KEY = 'courseboard.auth.browser.session'

export type AuthGateView =
  | { kind: 'app' }
  | { kind: 'hold-app' }
  | { kind: 'boot' }
  | { kind: 'loading'; authorizing: boolean }
  | { kind: 'sign-in'; reason?: AuthReason }
  | { kind: 'select-tenant' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable'; title: string; message: string }
  | { kind: 'error'; message: string }

const LAST_READY_SESSION_KEY = 'courseboard.auth.lastReadySession'

export type ReadySessionSnapshot = {
  user: AuthUser
  tenant: AuthTenant
}

/**
 * Decide what AuthGate should render. Login UI is only for confirmed anonymous.
 * Session revalidation never takes over the full screen when a prior session is known
 * (in-memory previous, persisted snapshot, or restorable tokens).
 */
export function resolveAuthGateView(state: AuthState): AuthGateView {
  if (state.status === 'ready') return { kind: 'app' }
  if (state.status === 'booting') {
    if (state.previous || state.restorable) return { kind: 'hold-app' }
    // Cold start with no session hint — minimal boot, not a "Verifying session" takeover.
    return { kind: 'boot' }
  }
  if (state.status === 'authorizing') return { kind: 'loading', authorizing: true }
  if (state.status === 'anonymous') return { kind: 'sign-in', reason: state.reason }
  if (state.status === 'selecting-tenant') return { kind: 'select-tenant' }
  if (state.status === 'forbidden') return { kind: 'forbidden' }
  if (state.status === 'unavailable') {
    return { kind: 'unavailable', title: state.title, message: state.message }
  }
  return { kind: 'error', message: state.message }
}

/** Bottom-right toast while a known/restorable session is being revalidated. */
export function sessionVerifyingNotice(state: AuthState): string | undefined {
  if (state.status !== 'booting') return undefined
  if (state.previous || state.restorable) return 'Verifying session…'
  return undefined
}

/**
 * Session-expired toast only when a prior authenticated session definitively
 * failed verification. Cold start / navigation / missing reason must not toast.
 */
export function sessionExpiredNotice(
  reason?: AuthReason,
  hadAuthenticatedSession = true,
): string | undefined {
  if (reason !== 'expired' || !hadAuthenticatedSession) return undefined
  return 'Your session expired. Please sign in again.'
}

export type BeginBootOptions = {
  snapshot?: ReadySessionSnapshot
  restorable?: boolean
}

/** Preserve the last ready session while bootstrap/revalidation is in flight. */
export function beginBoot(
  current: AuthState,
  options: BeginBootOptions = {},
): { next: AuthState; holdingSession: boolean } {
  if (current.status === 'ready') {
    return {
      next: { status: 'booting', previous: { user: current.user, tenant: current.tenant } },
      holdingSession: true,
    }
  }
  if (current.status === 'booting' && current.previous) {
    return { next: current, holdingSession: true }
  }
  if (current.status === 'booting' && current.restorable) {
    return { next: current, holdingSession: true }
  }
  if (options.snapshot) {
    return {
      next: {
        status: 'booting',
        previous: { user: options.snapshot.user, tenant: options.snapshot.tenant },
        restorable: true,
      },
      holdingSession: true,
    }
  }
  if (options.restorable) {
    return { next: { status: 'booting', restorable: true }, holdingSession: true }
  }
  return { next: { status: 'booting' }, holdingSession: false }
}

export function readLastReadySession(): ReadySessionSnapshot | undefined {
  try {
    const raw = localStorage.getItem(LAST_READY_SESSION_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<ReadySessionSnapshot>
    if (!parsed.user?.id || !parsed.tenant?.id) return undefined
    return {
      user: parsed.user as AuthUser,
      tenant: parsed.tenant as AuthTenant,
    }
  } catch {
    return undefined
  }
}

export function writeLastReadySession(user: AuthUser, tenant: AuthTenant) {
  try {
    localStorage.setItem(LAST_READY_SESSION_KEY, JSON.stringify({ user, tenant }))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearLastReadySession() {
  try {
    localStorage.removeItem(LAST_READY_SESSION_KEY)
  } catch {
    // Ignore storage failures during sign-out.
  }
}

/** True when durable browser-pkce tokens suggest a session can be restored. */
export function hasRestorableBrowserSession(): boolean {
  try {
    const raw = localStorage.getItem(BROWSER_PKCE_SESSION_KEY)
    if (!raw) {
      return Boolean(sessionStorage.getItem('courseboard.auth.browser.refresh'))
    }
    const parsed = JSON.parse(raw) as { accessToken?: string; refreshToken?: string }
    return Boolean(parsed.accessToken || parsed.refreshToken)
  } catch {
    return false
  }
}
