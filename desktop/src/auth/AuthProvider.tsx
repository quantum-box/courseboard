import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { configureApiAuth } from '../api'
import { createAuthAdapter } from './adapters'
import {
  beginBoot,
  clearLastReadySession,
  hasRestorableBrowserSession,
  readLastReadySession,
  sessionExpiredNotice,
  writeLastReadySession,
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

type AuthContextValue = {
  state: AuthState
  user?: AuthUser
  tenant?: AuthTenant
  sessionNotice?: string
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
  const [sessionNotice, setSessionNotice] = useState<string | undefined>()

  useEffect(() => {
    try {
      setAdapter(createAuthAdapter())
    } catch (error) {
      if (error instanceof AuthConfigurationError) {
        setState({ status: 'unavailable', title: error.title, message: error.message })
      } else {
        setState({ status: 'error', message: '認証を初期化できませんでした。' })
      }
    }
  }, [])

  const dismissSessionNotice = useCallback(() => {
    setSessionNotice(undefined)
  }, [])

  const denyAccess = useCallback(() => {
    configureApiAuth(null)
    setState(current => current.status === 'ready'
      ? { status: 'forbidden', user: current.user, tenant: current.tenant }
      : current)
  }, [])

  const signOut = useCallback(async (reason: AuthReason = 'logout') => {
    configureApiAuth(null)
    clearLastReadySession()
    const notice = sessionExpiredNotice(reason)
    if (notice) setSessionNotice(notice)
    setState({ status: 'anonymous', reason })
    await adapter?.signOut(reason)
  }, [adapter])

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
      configureApiAuth(null)
    }
    adapter.bootstrap()
      .then(result => {
        if (cancelled) return
        if (result.kind === 'anonymous') {
          configureApiAuth(null)
          clearLastReadySession()
          setAvailableTenants([])
          const notice = sessionExpiredNotice(result.reason)
          if (notice) setSessionNotice(notice)
          setState({ status: 'anonymous', reason: result.reason })
          return
        }
        setAvailableTenants(result.tenants)
        const selection = selectedTenant(result.user, result.tenants)
        if (selection.requestedMissing) {
          setState(result.partial
            ? {
                status: 'unavailable',
                title: 'テナント情報を確認できません',
                message: '指定された施設の権限を完全に確認できませんでした。時間をおいて再試行してください。',
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
          setState({ status: 'unavailable', title: error.title, message: error.message })
          return
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : '認証状態を確認できませんでした。',
        })
      })
    return () => {
      cancelled = true
    }
  }, [activateTenant, adapter, attempt, bindTenant])

  const signIn = useCallback(async (provider?: 'Google') => {
    if (!adapter) return
    configureApiAuth(null)
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
        message: error instanceof Error ? error.message : 'ログインを開始できませんでした。',
      })
    }
  }, [adapter])

  const signInWithPassword = useCallback(async (username: string, password: string) => {
    if (!adapter?.signInWithPassword) return
    configureApiAuth(null)
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
        message: error instanceof Error ? error.message : 'ログインできませんでした。',
      })
    }
  }, [adapter])

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
    configureApiAuth(null)
    replaceRequestedTenant()
    setState({ status: 'selecting-tenant', user: currentUser, tenants: availableTenants })
  }, [availableTenants, state])

  const identity = resolveIdentity(state)
  const value = useMemo<AuthContextValue>(() => ({
    state,
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
