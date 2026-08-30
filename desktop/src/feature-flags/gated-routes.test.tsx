/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../i18n'
import { PageReloadProvider } from '../lib/pageReload'
import { AppShell } from '../components/AppShell'
import { GolfHomePage } from '../features/golf/GolfHomePage'
import { FEATURE_FLAG_KEYS, FeatureFlagProvider } from './FeatureFlags'
import { ROUTE_FEATURE_FLAGS, routeGateFrom } from './gated-routes'

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

const IMPORT_ROUTE = 'golf/reservation-report-import'
const IMPORT_LABEL = /予約表をとりこむ/

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

function flagsUnavailable() {
  api.json.mockImplementation(async (path: string) => {
    if (path === '/v1/course/feature-flags/evaluate') {
      throw new Error('provider_error')
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

function renderWith(children: React.ReactNode) {
  render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <FeatureFlagProvider>{children}</FeatureFlagProvider>
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

/** provider を挟まない描画。AuthGate の期限切れ経路がこの形になる。 */
function renderWithoutProvider(children: React.ReactNode) {
  render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>{children}</PageReloadProvider>
    </I18nextProvider>,
  )
}

const shell = <AppShell route="golf"><div /></AppShell>

describe('フラグで出し分ける画面', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    api.json.mockReset()
    localStorage.clear()
    stubMatchMedia()
  })

  afterEach(cleanup)

  it('ルートとフラグの対応表は 1 つ', () => {
    expect(ROUTE_FEATURE_FLAGS[IMPORT_ROUTE])
      .toBe(FEATURE_FLAG_KEYS.reservationReportImport)
  })

  describe('サイドバー', () => {
    it('フラグが立っていれば出る', async () => {
      flagsAnswer(true)
      renderWith(shell)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: IMPORT_LABEL }).length).toBeGreaterThan(0)
      })
    })

    it('フラグが降りていれば出さない', async () => {
      flagsAnswer(false)
      renderWith(shell)

      await waitFor(() => expect(api.json).toHaveBeenCalled())
      await waitFor(() => {
        expect(screen.queryAllByRole('button', { name: IMPORT_LABEL })).toHaveLength(0)
      })
    })

    it('ピン留めしてあっても、フラグが降りていれば出さない', async () => {
      localStorage.setItem('courseboard.sidebar.pinned', JSON.stringify([IMPORT_ROUTE]))
      flagsAnswer(false)
      renderWith(shell)

      await waitFor(() => expect(api.json).toHaveBeenCalled())
      await waitFor(() => {
        expect(screen.queryAllByRole('button', { name: IMPORT_LABEL })).toHaveLength(0)
      })
    })
  })

  // CLAUDE.md いわく、上流が落ちても画面は使えるままにする。フラグは認可では
  // なく出し分けの switch なので、評価できなかっただけで入口を消さない。
  it('評価が失敗しても入口を消さない', async () => {
    flagsUnavailable()
    renderWith(shell)

    await waitFor(() => expect(api.json).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: IMPORT_LABEL }).length).toBeGreaterThan(0)
    })
  })

  // AuthGate は期限切れのセッションでも shell を描くが、その経路は
  // FeatureFlagProvider の外側にある。ここで hook が投げると、ログインし直せと
  // 伝えるべき場面で画面ごと落ちる。
  it('provider が無くても落ちず、入口も消さない', async () => {
    renderWithoutProvider(shell)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: IMPORT_LABEL }).length).toBeGreaterThan(0)
    })
    expect(api.json).not.toHaveBeenCalled()
  })

  describe('ホーム画面のタイル', () => {
    it('フラグが立っていれば出る', async () => {
      flagsAnswer(true)
      renderWith(<GolfHomePage />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: IMPORT_LABEL }).length).toBeGreaterThan(0)
      })
    })

    // サイドバーだけ塞いでタイルを残すと、押した先が 404 になる。
    it('フラグが降りていれば出さない', async () => {
      flagsAnswer(false)
      renderWith(<GolfHomePage />)

      await waitFor(() => expect(api.json).toHaveBeenCalled())
      await waitFor(() => {
        expect(screen.queryAllByRole('button', { name: IMPORT_LABEL })).toHaveLength(0)
      })
    })
  })
})

describe('routeGateFrom', () => {
  const state = (over: Partial<{ enabled: boolean; error: boolean; isLoading: boolean }> = {}) => ({
    enabled: false,
    error: false,
    isLoading: false,
    ...over,
  })

  it('フラグを持たないルートは常に出す', () => {
    expect(routeGateFrom(undefined, state())).toBe('visible')
  })

  it('評価が返るまでは待つ', () => {
    expect(routeGateFrom('feature.courseboard.x', state({ isLoading: true }))).toBe('loading')
  })

  it('フラグが立っていれば出す', () => {
    expect(routeGateFrom('feature.courseboard.x', state({ enabled: true }))).toBe('visible')
  })

  it('フラグが降りていれば隠す', () => {
    expect(routeGateFrom('feature.courseboard.x', state())).toBe('hidden')
  })

  // 上流が落ちただけで画面が消えると、受付には理由が何も見えない。
  // フラグは認可ではなく出し分けの switch なので、答えが得られないときは残す。
  it('評価できなかったときは隠さない', () => {
    expect(routeGateFrom('feature.courseboard.x', state({ error: true }))).toBe('visible')
    expect(routeGateFrom('feature.courseboard.x', state({ error: true, isLoading: true })))
      .toBe('visible')
  })
})
