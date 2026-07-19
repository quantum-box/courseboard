import { Badge, Button } from '@tachyon-sdk/native-ui'
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  LogIn,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CourseBoardBrand } from '../components/CourseBoardBrand'
import type { AuthReason, AuthTenant } from './types'

// Google login is not verified yet; keep the auth adapter logic but hide the UI entry point.
const GOOGLE_SIGN_IN_ENABLED = false

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-brand"><CourseBoardBrand variant="auth" /></div>
        <div className="auth-brand-copy">
          <h1>クラブ運営を、<br />ひとつの画面で。</h1>
          <p>予約、キャディ、コース、キャンセル料まで。現場と経営をつなぐゴルフ場オペレーション基盤。</p>
        </div>
        <div className="auth-platforms"><span>Web</span><span>Desktop</span><span>iOS / Android</span></div>
      </section>
      <section className="auth-content-panel">{children}</section>
    </main>
  )
}

/** Minimal cold-start placeholder when no prior session hint exists (not a verify takeover). */
export function AuthBootScreen() {
  return (
    <main className="auth-neutral-loading" role="status" aria-label="Loading">
      <LoaderCircle className="auth-spinner" />
    </main>
  )
}

/** Neutral full-page status while redirecting into an external sign-in flow. */
export function AuthLoadingScreen({ authorizing = false }: { authorizing?: boolean }) {
  return (
    <main className="auth-neutral-loading" role="status">
      <LoaderCircle className="auth-spinner" />
      {authorizing ? (
        <>
          <h2>Redirecting to sign in…</h2>
          <p>Please wait while we open the secure sign-in flow.</p>
        </>
      ) : null}
    </main>
  )
}

export function AuthSessionToast({ message, onDismiss, sticky = false }: {
  message: string
  onDismiss(): void
  /** When true, keep the toast until the parent clears it (e.g. verifying). */
  sticky?: boolean
}) {
  useEffect(() => {
    if (sticky) return
    const timer = window.setTimeout(onDismiss, 7000)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss, sticky])

  return (
    <div className="auth-session-toast" role="status">
      <ShieldCheck aria-hidden="true" />
      <p>{message}</p>
      {sticky ? null : (
        <button type="button" className="auth-session-toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

export function SignInScreen({ reason, passwordSignInAvailable, onSignIn, onPasswordSignIn }: {
  reason?: AuthReason
  passwordSignInAvailable: boolean
  onSignIn(provider?: 'Google'): void
  onPasswordSignIn(username: string, password: string): void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onPasswordSignIn(username.trim(), password)
  }

  return (
    <AuthFrame>
      <div className="auth-card">
        <span className="auth-kicker">Secure access</span>
        <h2>おかえりなさい</h2>
        <p>TachyonアカウントでCourse Boardにログインします。</p>
        {reason === 'expired' ? (
          <div className="auth-notice" role="status">
            <ShieldCheck />
            <div><strong>セッションが失効しました</strong><span>安全のためログアウトしました。もう一度ログインしてください。</span></div>
          </div>
        ) : null}
        {passwordSignInAvailable ? (
          <form className="auth-login-form" onSubmit={submit}>
            <label>
              <span>ユーザー名またはメールアドレス</span>
              <input
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={event => setUsername(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              <span>パスワード</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
              />
            </label>
            <Button type="submit" variant="primary" disabled={!username.trim() || !password}>
              <LogIn /> ログイン
            </Button>
          </form>
        ) : (
          <div className="auth-actions">
            {GOOGLE_SIGN_IN_ENABLED ? (
              <Button type="button" variant="secondary" onClick={() => onSignIn('Google')}>
                <strong className="google-mark">G</strong> Googleでログイン
              </Button>
            ) : null}
            <Button type="button" variant="primary" onClick={() => onSignIn()}>
              <LogIn /> ログイン
            </Button>
          </div>
        )}
        <p className="auth-legal">続行すると、利用規約およびプライバシーポリシーに同意したものとみなされます。</p>
      </div>
    </AuthFrame>
  )
}

export function TenantSelectionScreen({ tenants, onSelect, onSignOut }: {
  tenants: AuthTenant[]
  onSelect(tenant: AuthTenant): void
  onSignOut(): void
}) {
  return (
    <AuthFrame>
      <div className="auth-card auth-card-wide">
        <span className="auth-kicker">Tenant</span>
        <h2>利用する施設を選択</h2>
        <p>このセッションで操作するテナントを選択してください。</p>
        <div className="tenant-list">
          {tenants.map(tenant => (
            <button key={`${tenant.mode}:${tenant.id}`} type="button" className="tenant-option" onClick={() => onSelect(tenant)}>
              <span className="tenant-icon"><Building2 /></span>
              <span className="tenant-copy"><strong>{tenant.name}</strong><small>{tenant.slug ?? tenant.id}</small></span>
              <Badge variant={tenant.mode === 'production' ? 'success' : 'warning'}>
                {tenant.mode === 'production' ? 'Production' : 'Sandbox'}
              </Badge>
              <ChevronRight />
            </button>
          ))}
        </div>
        <Button type="button" variant="ghost" onClick={onSignOut}>別のアカウントでログイン</Button>
      </div>
    </AuthFrame>
  )
}

export function AuthProblemScreen({ title, message, configuration = false, onRetry, onSignOut, onSwitchTenant }: {
  title: string
  message: string
  configuration?: boolean
  onRetry?: () => void
  onSignOut?: () => void
  onSwitchTenant?: () => void
}) {
  return (
    <AuthFrame>
      <div className="auth-card">
        <span className={`auth-problem-icon ${configuration ? 'configuration' : ''}`}>
          {configuration ? <ShieldCheck /> : <AlertTriangle />}
        </span>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="auth-actions">
          {onSwitchTenant ? <Button type="button" variant="primary" onClick={onSwitchTenant}><Building2 /> 施設を選択</Button> : null}
          {onRetry ? <Button type="button" variant="primary" onClick={onRetry}><RefreshCw /> 再試行</Button> : null}
          {onSignOut ? <Button type="button" variant="secondary" onClick={onSignOut}><ExternalLink /> ログアウト</Button> : null}
        </div>
      </div>
    </AuthFrame>
  )
}
