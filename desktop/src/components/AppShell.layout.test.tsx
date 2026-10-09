/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
const access = vi.hoisted(() => ({ otherBusinessAccess: true, list: true, manage: true }))

vi.mock('../auth/EffectiveCapabilitiesProvider', () => ({
  useEffectiveCapabilities: () => ({ capabilities: {
    actions: access.otherBusinessAccess ? {
      'field_extension_golf:ListTeeSheet': true,
      'field_extension_golf:ListSlotOverrides': true,
      'field_extension_golf:ListCourses': true,
      'field_extension_golf:ListProducts': true,
      'field_extension_golf:ListCaddieInsights': true,
      'field_extension_golf:ListCaddieAssignments': true,
      'field_extension_golf:ListShifts': true,
    } : {},
    navigation: { otherBusinessAccess: access.otherBusinessAccess },
    cancellationFees: { list: access.list, manage: access.manage },
  } }),
}))

vi.mock('../auth/adapters', () => ({
  createAuthAdapter: () => authAdapter,
}))

vi.mock('../lib/newVersion', () => ({
  useNewVersionAvailable: vi.fn(() => true),
}))

describe('AppShell layout: the new-version banner stays inside the content column', () => {
  beforeEach(async () => {
    access.otherBusinessAccess = true
    access.list = true
    access.manage = true
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
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    HTMLElement.prototype.scrollIntoView = vi.fn()
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

  it('removes old business pins and search entries for a fee-only caller', async () => {
    access.otherBusinessAccess = false
    localStorage.setItem('courseboard.sidebar.pinned', JSON.stringify(['golf/ledger', 'staff', 'cancellation-fees']))
    render(<I18nextProvider i18n={i18next}><AuthProvider><AuthGate>
      <AppShell route="cancellation-fees"><div>fee-only content</div></AppShell>
    </AuthGate></AuthProvider></I18nextProvider>)
    await screen.findByText('fee-only content')
    expect(screen.queryByRole('button', { name: i18next.t('nav:items.golf/ledger.label') })).toBeNull()
    expect(screen.queryByRole('button', { name: i18next.t('nav:items.staff.label') })).toBeNull()
    expect(screen.queryAllByRole('button', { name: i18next.t('nav:items.cancellation-fees.label') }).length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await screen.findByRole('combobox')
    const options = screen.getAllByRole('option').map(item => item.textContent)
    expect(options.some(text => text?.includes(i18next.t('nav:items.golf/ledger.label')))).toBe(false)
    expect(options.some(text => text?.includes(i18next.t('nav:items.cancellation-fees.label')))).toBe(true)
  })

  it('removes fee navigation for a different-product caller without List', async () => {
    access.list = false
    access.manage = false
    localStorage.setItem('courseboard.sidebar.pinned', JSON.stringify(['cancellation-fees']))
    render(<I18nextProvider i18n={i18next}><AuthProvider><AuthGate>
      <AppShell route="golf"><div>other-product content</div></AppShell>
    </AuthGate></AuthProvider></I18nextProvider>)
    await screen.findByText('other-product content')
    expect(screen.queryByRole('button', { name: i18next.t('nav:items.cancellation-fees.label') })).toBeNull()
    expect(screen.queryAllByRole('button', { name: i18next.t('nav:items.golf/ledger.label') }).length).toBeGreaterThan(0)
  })
})
