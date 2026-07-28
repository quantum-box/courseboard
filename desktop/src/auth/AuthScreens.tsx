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
import { useTranslation } from 'react-i18next'
import { CourseBoardBrand } from '../components/CourseBoardBrand'
import type { AuthReason, AuthTenant } from './types'

// Google login is not verified yet; keep the auth adapter logic but hide the UI entry point.
const GOOGLE_SIGN_IN_ENABLED = false

function AuthFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth')
  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-brand"><CourseBoardBrand variant="auth" /></div>
        <div className="auth-brand-copy">
          <h1>{t('brand.title')}</h1>
          <p>{t('brand.description')}</p>
        </div>
        <div className="auth-platforms"><span>Web</span><span>Desktop</span><span>iOS / Android</span></div>
      </section>
      <section className="auth-content-panel">{children}</section>
    </main>
  )
}

/** Minimal cold-start placeholder when no prior session hint exists (not a verify takeover). */
export function AuthBootScreen() {
  const { t } = useTranslation('auth')
  return (
    <main className="auth-neutral-loading" role="status" aria-label={t('loading.label')}>
      <LoaderCircle className="auth-spinner" />
    </main>
  )
}

/** Neutral full-page status while redirecting into an external sign-in flow. */
export function AuthLoadingScreen({ authorizing = false }: { authorizing?: boolean }) {
  const { t } = useTranslation('auth')
  return (
    <main className="auth-neutral-loading" role="status">
      <LoaderCircle className="auth-spinner" />
      {authorizing ? (
        <>
          <h2>{t('loading.redirecting')}</h2>
          <p>{t('loading.wait')}</p>
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
  const { t } = useTranslation('auth')
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
        <button
          type="button"
          className="auth-session-toast-dismiss"
          onClick={onDismiss}
          aria-label={t('loading.dismiss')}
        >
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
  const { t } = useTranslation('auth')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onPasswordSignIn(username.trim(), password)
  }

  return (
    <AuthFrame>
      <div className="auth-card">
        <span className="auth-kicker">{t('signIn.kicker')}</span>
        <h2>{t('signIn.title')}</h2>
        <p>{t('signIn.description')}</p>
        {reason === 'expired' ? (
          <div className="auth-notice" role="status">
            <ShieldCheck />
            <div>
              <strong>{t('signIn.expired.title')}</strong>
              <span>{t('signIn.expired.description')}</span>
            </div>
          </div>
        ) : null}
        {passwordSignInAvailable ? (
          <form className="auth-login-form" onSubmit={submit}>
            <label>
              <span>{t('signIn.username')}</span>
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
              <span>{t('signIn.password')}</span>
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
              <LogIn /> {t('signIn.submit')}
            </Button>
          </form>
        ) : (
          <div className="auth-actions">
            {GOOGLE_SIGN_IN_ENABLED ? (
              <Button type="button" variant="secondary" onClick={() => onSignIn('Google')}>
                <strong className="google-mark">G</strong> {t('signIn.google')}
              </Button>
            ) : null}
            <Button type="button" variant="primary" onClick={() => onSignIn()}>
              <LogIn /> {t('signIn.submit')}
            </Button>
          </div>
        )}
        <p className="auth-legal">{t('signIn.legal')}</p>
      </div>
    </AuthFrame>
  )
}

export function TenantSelectionScreen({ tenants, onSelect, onSignOut }: {
  tenants: AuthTenant[]
  onSelect(tenant: AuthTenant): void
  onSignOut(): void
}) {
  const { t } = useTranslation('auth')
  return (
    <AuthFrame>
      <div className="auth-card auth-card-wide">
        <span className="auth-kicker">{t('tenant.kicker')}</span>
        <h2>{t('tenant.title')}</h2>
        <p>{t('tenant.description')}</p>
        <div className="tenant-list">
          {tenants.map(tenant => (
            <button key={`${tenant.mode}:${tenant.id}`} type="button" className="tenant-option" onClick={() => onSelect(tenant)}>
              <span className="tenant-icon"><Building2 /></span>
              <span className="tenant-copy"><strong>{tenant.name}</strong><small>{tenant.slug ?? tenant.id}</small></span>
              <Badge variant={tenant.mode === 'production' ? 'success' : 'warning'}>
                {tenant.mode === 'production' ? t('tenant.production') : t('tenant.sandbox')}
              </Badge>
              <ChevronRight />
            </button>
          ))}
        </div>
        <Button type="button" variant="ghost" onClick={onSignOut}>{t('tenant.otherAccount')}</Button>
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
  const { t } = useTranslation(['auth', 'common', 'nav'])
  return (
    <AuthFrame>
      <div className="auth-card">
        <span className={`auth-problem-icon ${configuration ? 'configuration' : ''}`}>
          {configuration ? <ShieldCheck /> : <AlertTriangle />}
        </span>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="auth-actions">
          {onSwitchTenant ? (
            <Button type="button" variant="primary" onClick={onSwitchTenant}>
              <Building2 /> {t('auth:tenant.select')}
            </Button>
          ) : null}
          {onRetry ? (
            <Button type="button" variant="primary" onClick={onRetry}>
              <RefreshCw /> {t('common:action.retry')}
            </Button>
          ) : null}
          {onSignOut ? (
            <Button type="button" variant="secondary" onClick={onSignOut}>
              <ExternalLink /> {t('nav:account.signOut')}
            </Button>
          ) : null}
        </div>
      </div>
    </AuthFrame>
  )
}
