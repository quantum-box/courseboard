import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { configureApiAuth } from '../api'
import { createAuthAdapter } from './adapters'
import {
  beginBoot,
  clearLastReadySession,
  hasRestorableBrowserSession,
  profileRevalidationError,
  readLastReadySession,
  sessionExpiredNotice,
  writeLastReadySession,
  type AuthNoticeKey,
} from './authGateView'
import {
  AuthConfigurationError,
  type AuthAdapter,
  type AuthReason,
  type AuthState,
  type AuthTenant,
  type AuthUser,
} from './types'
import { resolveTenantSelection } from './tenant-selection'
import { i18next } from '../i18n'

type AuthContextValue = {
  state: AuthState
  apiAuthReady: boolean
  user?: AuthUser
  tenant?: AuthTenant
  sessionNotice?: AuthNoticeKey
  dismissSessionNotice(): void
  signIn(provider?: 'Google'): Promise<void>
  passwordSignInAvailable: boolean
  signInWithPassword(username: string, password: string): Promise<void>
  signOut(reason?: AuthReason): Promise<void>
  selectTenant(tenant: AuthTenant): void
  switchTenant(): void
  retry(): void
  denyAccess(): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function selectedTenant(user: AuthUser, tenants: AuthTenant[]) {
  const requested = new URLSearchParams(window.location.search).get('tenant')
  const saved = localStorage.getItem(`courseboard.auth.tenant.${user.id}`)
  return resolveTenantSelection(tenants, requested, saved)
}

function replaceRequestedTenant(tenantId?: string) {
  const url = new URL(window.location.href)
  if (tenantId) url.searchParams.set('tenant', tenantId)
  else url.searchParams.delete('tenant')
  window.history.replaceState(window.history.state, '', url)
}

function resolveIdentity(state: AuthState) {
  if (state.status === 'ready') return { user: state.user, tenant: state.tenant }
  if (state.status === 'booting' && state.previous) {
    return { user: state.previous.user, tenant: state.previous.tenant }
  }
  if (state.status === 'selecting-tenant') return { user: state.user, tenant: undefined }
  if (state.status === 'forbidden') return { user: state.user, tenant: state.tenant }
  return { user: undefined, tenant: undefined }
}

function bootHints() {
  const snapshot = readLastReadySession()
  return {
    snapshot,
    restorable: Boolean(snapshot) || hasRestorableBrowserSession(),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adapter, setAdapter] = useState<AuthAdapter | null>(null)
  const [state, setState] = useState<AuthState>(() => {
    const hints = bootHints()
    if (hints.snapshot) {
      return {
        status: 'booting',
        previous: { user: hints.snapshot.user, tenant: hints.snapshot.tenant },
        restorable: true,
      }
    }
    if (hints.restorable) return { status: 'booting', restorable: true }
    return { status: 'booting' }
  })
  const [availableTenants, setAvailableTenants] = useState<AuthTenant[]>([])
  const [attempt, setAttempt] = useState(0)
  const [sessionNotice, setSessionNotice] = useState<AuthNoticeKey | undefined>()
  const [apiAuthReady, setApiAuthReady] = useState(false)

  useEffect(() => {
    try {
      setAdapter(createAuthAdapter())
    } catch (error) {
      if (error instanceof AuthConfigurationError) {
        setState({ status: 'unavailable', title: error.title, message: error.message })
      } else {
        setState({ status: 'error', message: i18next.t('auth:problem.initFailed') })
      }
    }
  }, [])

  const dismissSessionNotice = useCallback(() => {
    setSessionNotice(undefined)
  }, [])

  const clearApiAuth = useCallback(() => {
    configureApiAuth(null)
    setApiAuthReady(false)
  }, [])

  const denyAccess = useCallback(() => {
    clearApiAuth()
    setState(current => current.status === 'ready'
      ? { status: 'forbidden', user: current.user, tenant: current.tenant }
      : current)
  }, [clearApiAuth])

  const signOut = useCallback(async (reason: AuthReason = 'logout') => {
    clearApiAuth()
    clearLastReadySession()
    const notice = sessionExpiredNotice(reason)
    if (notice) setSessionNotice(notice)
    setState({ status: 'anonymous', reason })
    await adapter?.signOut(reason)
  }, [adapter, clearApiAuth])

  const bindTenant = useCallback((tenant: AuthTenant) => {
    if (!adapter) return false
    configureApiAuth({
      tenantId: tenant.id,
      operatorId: tenant.operatorId,
      platformId: tenant.platformId,
      getAccessToken: force => adapter.getAccessToken(force),
      onUnauthorized: () => { void signOut('expired') },
      onForbidden: denyAccess,
    })
    setApiAuthReady(true)
    return true
  }, [adapter, denyAccess, signOut])

  const activateTenant = useCallback((user: AuthUser, tenant: AuthTenant) => {
    if (!bindTenant(tenant)) return
    writeLastReadySession(user, tenant)
    setState({ status: 'ready', user, tenant })
  }, [bindTenant])

  useEffect(() => {
    if (!adapter) return
    let cancelled = false
    let holdingSession = false
    let heldPrevious: { user: AuthUser; tenant: AuthTenant } | undefined
    setState(current => {
      const boot = beginBoot(current, bootHints())
      holdingSession = boot.holdingSession
      if (boot.next.status === 'booting') heldPrevious = boot.next.previous
      return boot.next
    })
    if (holdingSession && heldPrevious) {
      bindTenant(heldPrevious.tenant)
    } else if (!holdingSession) {
      clearApiAuth()
    }
    adapter.bootstrap()
      .then(result => {
        if (cancelled) return
        if (result.kind === 'anonymous') {
          const hadAuthenticatedSession = holdingSession || Boolean(heldPrevious)
          clearApiAuth()
          clearLastReadySession()
          setAvailableTenants([])
          const notice = sessionExpiredNotice(result.reason, hadAuthenticatedSession)
          if (notice) setSessionNotice(notice)
          setState({ status: 'anonymous', reason: result.reason })
          return
        }
        // Drop the held tenant before applying the freshly filtered profile.
        // activateTenant writes back only a tenant confirmed by this response.
        clearApiAuth()
        clearLastReadySession()
        setAvailableTenants(result.tenants)
        const selection = selectedTenant(result.user, result.tenants)
        if (selection.requestedMissing) {
          setState(result.partial
            ? {
                status: 'unavailable',
                title: i18next.t('auth:problem.tenantUnverified.title'),
                message: i18next.t('auth:problem.tenantUnverified.description'),
              }
            : { status: 'forbidden', user: result.user })
        } else if (selection.tenant) {
          activateTenant(result.user, selection.tenant)
        } else if (result.tenants.length > 0) {
          setState({ status: 'selecting-tenant', user: result.user, tenants: result.tenants })
        } else {
          setState({ status: 'forbidden', user: result.user })
        }
      })
      .catch(error => {
        if (cancelled) return
        if (error instanceof AuthConfigurationError) {
          clearApiAuth()
          setState({ status: 'unavailable', title: error.title, message: error.message })
          return
        }
        // Extension eligibility is unknown when profile revalidation fails.
        // Keep the Cognito session retryable, but never reactivate a stale tenant.
        clearApiAuth()
        clearLastReadySession()
        setAvailableTenants([])
        setState(profileRevalidationError(error))
      })
    return () => {
      cancelled = true
    }
  }, [activateTenant, adapter, attempt, bindTenant, clearApiAuth])

  const signIn = useCallback(async (provider?: 'Google') => {
    if (!adapter) return
    clearApiAuth()
    setState({ status: 'authorizing' })
    try {
      await adapter.signIn(provider)
      setAttempt(value => value + 1)
    } catch (error) {
      if (error instanceof AuthConfigurationError) {
        setState({ status: 'unavailable', title: error.title, message: error.message })
        return
      }
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : i18next.t('auth:problem.startFailed'),
      })
    }
  }, [adapter, clearApiAuth])

  const signInWithPassword = useCallback(async (username: string, password: string) => {
    if (!adapter?.signInWithPassword) return
    clearApiAuth()
    setState({ status: 'authorizing' })
    try {
      await adapter.signInWithPassword(username, password)
      setAttempt(value => value + 1)
    } catch (error) {
      if (error instanceof AuthConfigurationError) {
        setState({ status: 'unavailable', title: error.title, message: error.message })
        return
      }
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : i18next.t('auth:problem.signInFailed'),
      })
    }
  }, [adapter, clearApiAuth])

  const selectTenant = useCallback((tenant: AuthTenant) => {
    if (state.status !== 'selecting-tenant' && state.status !== 'forbidden') return
    if (!state.user || !availableTenants.some(available => available.id === tenant.id)) return
    localStorage.setItem(`courseboard.auth.tenant.${state.user.id}`, tenant.id)
    replaceRequestedTenant(tenant.id)
    activateTenant(state.user, tenant)
  }, [activateTenant, availableTenants, state])

  const switchTenant = useCallback(() => {
    const currentUser = state.status === 'ready' || state.status === 'forbidden'
      ? state.user
      : undefined
    if (!currentUser || availableTenants.length === 0) return
    clearApiAuth()
    replaceRequestedTenant()
    setState({ status: 'selecting-tenant', user: currentUser, tenants: availableTenants })
  }, [availableTenants, clearApiAuth, state])

  const identity = resolveIdentity(state)
  const value = useMemo<AuthContextValue>(() => ({
    state,
    apiAuthReady,
    ...identity,
    sessionNotice,
    dismissSessionNotice,
    signIn,
    passwordSignInAvailable: Boolean(adapter?.signInWithPassword),
    signInWithPassword,
    signOut,
    selectTenant,
    switchTenant,
    retry: () => setAttempt(value => value + 1),
    denyAccess,
  }), [
    adapter,
    apiAuthReady,
    denyAccess,
    dismissSessionNotice,
    identity,
    selectTenant,
    sessionNotice,
    signIn,
    signInWithPassword,
    signOut,
    state,
    switchTenant,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
