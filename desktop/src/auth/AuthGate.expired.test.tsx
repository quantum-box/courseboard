/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseboardApiJson } from '../api'
import { AppShell } from '../components/AppShell'
import { i18next } from '../i18n'
import { AuthGate } from './AuthGate'
import { AuthProvider } from './AuthProvider'

const authAdapter = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  getAccessToken: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('./adapters', () => ({
  createAuthAdapter: () => authAdapter,
}))

const FAILED_PATHS = [
  '/v1/course/extension-status',
  '/v1/course/courses',
  '/v1/course/tee-ledger',
  '/v1/course/booking-horizon',
  '/v1/course/reservation-products',
]

function AllCourseApisFail() {
  useEffect(() => {
    void Promise.allSettled(FAILED_PATHS.map(path => courseboardApiJson(path)))
  }, [])
  return <p>protected course screen</p>
}

describe('expired authentication shell', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    localStorage.clear()
    window.history.replaceState({}, '', '/golf')
    vi.stubEnv('VITE_COURSEBOARD_API_BASE_URL', '')
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'browser-pkce')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    authAdapter.bootstrap.mockReset()
    authAdapter.getAccessToken.mockReset()
    authAdapter.signIn.mockReset()
    authAdapter.signOut.mockReset()
    authAdapter.bootstrap.mockResolvedValue({
      kind: 'authenticated',
      user: { id: 'user-1', name: 'Operator', role: 'ADMIN' },
      tenants: [{
        id: 'tenant-1',
        name: 'Test Course',
        mode: 'production',
        platformId: 'platform-1',
        operatorId: 'operator-1',
      }],
    })
    authAdapter.getAccessToken.mockResolvedValue('test-access-token')
    authAdapter.signIn.mockResolvedValue(undefined)
    authAdapter.signOut.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('keeps AppShell visible and asks for sign-in when every course API reports expiry', async () => {
    const fetchMock = vi.fn(async (..._args: [RequestInfo | URL, RequestInit?]) => new Response(JSON.stringify({
      error: 'upstream_authentication_expired',
      message: 'Field authentication expired',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <I18nextProvider i18n={i18next}>
        <AuthProvider>
          <AuthGate renderExpiredSession={session => (
            <AppShell route="golf">{session}</AppShell>
          )}>
            <AllCourseApisFail />
          </AuthGate>
        </AuthProvider>
      </I18nextProvider>,
    )

    await screen.findByText('ログインの有効期限が切れました')
    expect(document.querySelector('.app-shell')).not.toBeNull()
    expect(screen.getByText('安全のためログアウトしました。もう一度ログインしてください。')).toBeTruthy()
    expect(screen.queryByText('protected course screen')).toBeNull()
    await waitFor(() => {
      const requested = fetchMock.mock.calls.map(call => String(call[0]))
      for (const path of FAILED_PATHS) expect(requested).toContain(path)
    })
  })
})
