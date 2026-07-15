import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import {
  AuthLoadingScreen,
  AuthProblemScreen,
  SignInScreen,
  TenantSelectionScreen,
} from './AuthScreens'

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { state } = auth

  if (state.status === 'ready') return children
  if (state.status === 'booting' || state.status === 'authorizing') {
    return <AuthLoadingScreen authorizing={state.status === 'authorizing'} />
  }
  if (state.status === 'anonymous') {
    return <SignInScreen reason={state.reason} onSignIn={provider => { void auth.signIn(provider) }} />
  }
  if (state.status === 'selecting-tenant') {
    return (
      <TenantSelectionScreen
        tenants={state.tenants}
        onSelect={auth.selectTenant}
        onSignOut={() => { void auth.signOut() }}
      />
    )
  }
  if (state.status === 'forbidden') {
    return (
      <AuthProblemScreen
        title="このテナントを表示する権限がありません"
        message="アクセス可能な施設へ切り替えるか、管理者に権限を確認してください。"
        onSwitchTenant={auth.switchTenant}
        onSignOut={() => { void auth.signOut() }}
      />
    )
  }
  if (state.status === 'unavailable') {
    return <AuthProblemScreen title={state.title} message={state.message} configuration />
  }
  return (
    <AuthProblemScreen
      title="認証状態を確認できませんでした"
      message={state.message}
      onRetry={auth.retry}
      onSignOut={() => { void auth.signOut() }}
    />
  )
}
