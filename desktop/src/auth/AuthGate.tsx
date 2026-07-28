import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from './AuthProvider'
import {
  canRenderProtectedApp,
  resolveAuthGateView,
  sessionVerifyingNotice,
} from './authGateView'
import {
  AuthBootScreen,
  AuthLoadingScreen,
  AuthProblemScreen,
  AuthSessionToast,
  SignInScreen,
  TenantSelectionScreen,
} from './AuthScreens'

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth')
  const auth = useAuth()
  const view = resolveAuthGateView(auth.state)
  const verifyingNotice = sessionVerifyingNotice(auth.state)
  const noticeKey = auth.sessionNotice ?? verifyingNotice
  const toastMessage = noticeKey ? t(noticeKey) : undefined
  const toastSticky = Boolean(verifyingNotice) && !auth.sessionNotice

  let content: ReactNode
  if (canRenderProtectedApp(view, auth.apiAuthReady)) {
    content = children
  } else if (view.kind === 'boot' || view.kind === 'app' || view.kind === 'hold-app') {
    content = <AuthBootScreen />
  } else if (view.kind === 'loading') {
    content = <AuthLoadingScreen authorizing={view.authorizing} />
  } else if (view.kind === 'sign-in') {
    content = (
      <SignInScreen
        reason={view.reason}
        passwordSignInAvailable={auth.passwordSignInAvailable}
        onSignIn={provider => { void auth.signIn(provider) }}
        onPasswordSignIn={(username, password) => { void auth.signInWithPassword(username, password) }}
      />
    )
  } else if (view.kind === 'select-tenant') {
    content = (
      <TenantSelectionScreen
        tenants={auth.state.status === 'selecting-tenant' ? auth.state.tenants : []}
        onSelect={auth.selectTenant}
        onSignOut={() => { void auth.signOut() }}
      />
    )
  } else if (view.kind === 'forbidden') {
    content = (
      <AuthProblemScreen
        title={t('problem.forbidden.title')}
        message={t('problem.forbidden.description')}
        onSwitchTenant={auth.switchTenant}
        onSignOut={() => { void auth.signOut() }}
      />
    )
  } else if (view.kind === 'unavailable') {
    content = <AuthProblemScreen title={view.title} message={view.message} configuration />
  } else {
    content = (
      <AuthProblemScreen
        title={t('problem.unknown.title')}
        message={view.message}
        onRetry={auth.retry}
        onSignOut={() => { void auth.signOut() }}
      />
    )
  }

  return (
    <>
      {content}
      {toastMessage ? (
        <AuthSessionToast
          message={toastMessage}
          sticky={toastSticky}
          onDismiss={auth.dismissSessionNotice}
        />
      ) : null}
    </>
  )
}
