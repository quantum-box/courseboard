/* @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../i18n'
import { PageReloadProvider } from '../lib/pageReload'
import { AppShell } from '../components/AppShell'
import { FEATURE_FLAG_KEYS, FeatureFlagProvider } from './FeatureFlags'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    tenant: { id: 'tn_demo', name: 'デモ', platformId: 'tn_platform', mode: 'sandbox' },
    tenants: [],
    user: { email: 'course@example.com' },
    status: 'authenticated',
    signOut: vi.fn(),
    selectTenant: vi.fn(),
  }),
}))

/** Answer the evaluate call with one verdict for every key it is asked about. */
function flagsAnswer(enabled: boolean) {
  api.json.mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path === '/v1/course/feature-flags/evaluate') {
      const keys = (JSON.parse(init?.body ?? '{}') as { keys?: string[] }).keys ?? []
      return { values: keys.map(key => ({ key, enabled })) }
    }
    return { items: [] }
  })
}

/** jsdom does not implement matchMedia, and the shell reads it for the theme. */
function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

function renderShell() {
  render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <FeatureFlagProvider>
          <AppShell route="golf">
            <div />
          </AppShell>
        </FeatureFlagProvider>
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('フラグで出し分ける画面', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    api.json.mockReset()
    localStorage.clear()
    stubMatchMedia()
  })

  afterEach(cleanup)

  it('キーが登録されている', () => {
    expect(FEATURE_FLAG_KEYS.reservationReportImport)
      .toBe('feature.courseboard.reservation-report-import')
  })

  it('フラグが立っているテナントではサイドバーに出る', async () => {
    flagsAnswer(true)
    renderShell()

    await waitFor(() => {
      expect(document.body.innerHTML).toContain('予約表をとりこむ')
    })
  })

  it('フラグが降りていないテナントでは出さない', async () => {
    flagsAnswer(false)
    renderShell()

    // 評価が返ってから確かめる。返る前は読み込み中でどのみち出ていない。
    await waitFor(() => expect(api.json).toHaveBeenCalled())
    await waitFor(() => {
      expect(document.body.innerHTML).not.toContain('予約表をとりこむ')
    })
  })

  it('ピン留めしてあっても、フラグが降りていれば出さない', async () => {
    localStorage.setItem(
      'courseboard.sidebar.pinned',
      JSON.stringify(['golf/reservation-report-import']),
    )
    flagsAnswer(false)
    renderShell()

    await waitFor(() => expect(api.json).toHaveBeenCalled())
    await waitFor(() => {
      expect(document.body.innerHTML).not.toContain('予約表をとりこむ')
    })
  })
})
