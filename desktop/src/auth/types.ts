export type AuthUser = {
  id: string
  name: string
  email?: string
  role: string
}

export type AuthTenant = {
  id: string
  name: string
  slug?: string
  mode: 'production' | 'sandbox'
  platformId: string
  operatorId: string
}

export type AuthReason = 'expired' | 'logout'

export type AuthState =
  | { status: 'booting' }
  | { status: 'anonymous'; reason?: AuthReason }
  | { status: 'authorizing' }
  | { status: 'selecting-tenant'; user: AuthUser; tenants: AuthTenant[] }
  | { status: 'ready'; user: AuthUser; tenant: AuthTenant }
  | { status: 'forbidden'; user?: AuthUser; tenant?: AuthTenant }
  | { status: 'unavailable'; title: string; message: string }
  | { status: 'error'; message: string }

export type AuthBootstrapResult =
  | { kind: 'anonymous'; reason?: AuthReason }
  | { kind: 'authenticated'; user: AuthUser; tenants: AuthTenant[]; partial?: boolean }

export interface AuthAdapter {
  bootstrap(): Promise<AuthBootstrapResult>
  signIn(provider?: 'Google'): Promise<void>
  getAccessToken(forceRefresh?: boolean): Promise<string | undefined>
  signOut(reason?: AuthReason): Promise<void>
}

export class AuthConfigurationError extends Error {
  readonly title: string

  constructor(title: string, message: string) {
    super(message)
    this.name = 'AuthConfigurationError'
    this.title = title
  }
}
