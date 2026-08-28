/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from '../auth/AuthGate'
import { AuthProvider } from '../auth/AuthProvider'
import { i18next } from '../i18n'
import { AppShell } from './AppShell'

const authAdapter = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  getAccessToken: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../auth/adapters', () => ({
  createAuthAdapter: () => authAdapter,
}))

vi.mock('../lib/newVersion', () => ({
  useNewVersionAvailable: vi.fn(() => true),
}))

describe('AppShell layout: the new-version banner stays inside the content column', () => {
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

  it('nests the banner inside .app-workspace instead of anchoring to the viewport beside the sidebar', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <AuthProvider>
          <AuthGate>
            <AppShell route="golf">
              <div>protected content</div>
            </AppShell>
          </AuthGate>
        </AuthProvider>
      </I18nextProvider>,
    )

    await screen.findByText('protected content')

    const banner = document.querySelector('.new-version-banner')
    expect(banner).not.toBeNull()

    // Anchored inside the content column, not `position: fixed` to the whole
    // shell — a fixed offset from the viewport's left edge would sit partly
    // under the sidebar, which is what hid the banner's message in practice.
    const workspace = document.querySelector('.app-workspace')
    expect(workspace?.contains(banner)).toBe(true)

    // Not a direct child of `.app-shell` alongside the sidebar — that was the
    // old placement whose `left` offset ignored the sidebar's width entirely.
    const directShellChildren = Array.from(document.querySelector('.app-shell')?.children ?? [])
    expect(directShellChildren).not.toContain(banner)
  })
})
