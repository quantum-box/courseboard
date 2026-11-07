/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CaddiesPage } from './CaddiesPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const OPERATION_DATE = '2026-08-08'

function profile() {
  return {
    id: 'caddie-dispatch-tabs',
    displayName: 'タブ確認キャディ',
    active: true,
    skillLevel: 'regular' as const,
    rank: 'C' as const,
    employmentStatus: 'active',
    baseFeeAmount: 12000,
    currency: 'JPY',
    maxRoundsPerDay: 2,
    ratingCount: 0,
  }
}

function renderPage(initialView: 'dispatch' | 'duties' = 'dispatch') {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CaddiesPage initialView={initialView} />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('CaddiesPage dispatch tabs', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', `/golf/caddies/dispatch?date=${OPERATION_DATE}`)
    clearResourceCache()
    api.json.mockReset()
    api.json.mockImplementation(async (path: string) => {
      if (path === '/v1/course/caddie-profiles') {
        return { items: [profile()] }
      }
      if (path.startsWith('/v1/course/caddie-assignments?')) {
        return { items: [] }
      }
      if (path.startsWith('/v1/course/caddie-recommendations?')) {
        return { items: [] }
      }
      if (path.startsWith('/v1/course/caddie-attendance-snapshot?')) {
        return { date: OPERATION_DATE, items: [] }
      }
      if (path.startsWith('/v1/course/tee-sheet?')) {
        return { items: [] }
      }
      if (path.startsWith('/v1/course/caddie-availabilities?')) {
        return { items: [] }
      }
      if (path.startsWith('/v1/course/caddie-duty-assignments?')) {
        return { items: [] }
      }
      if (path.startsWith('/v1/course/caddie-shifts?')) {
        return { items: [] }
      }
      if (path.startsWith('/v1/course/caddie-supply?')) {
        return {
          date: OPERATION_DATE,
          availableCaddies: 1,
          twoRoundCapable: 0,
          caddieSupply: 1,
          morningCapacity: 1,
          afternoonCapacity: 1,
          safetyBuffer: 0,
          caddieAttachedCap: 1,
          currentCaddieAttached: 0,
          remaining: 1,
        }
      }
      if (path === `/v1/course/caddie-course-supply?date=${OPERATION_DATE}`) {
        return { date: OPERATION_DATE, courses: [], unplacedCaddies: 0 }
      }
      throw new Error(`Unexpected API call: GET ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.restoreAllMocks()
  })

  it('shows the round ledger as a page without the dispatch tabs', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '組ごとのキャディ配置' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /ラウンド配置|別業務/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'キャディを自動配置' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '別業務' })).toBeNull()
    expect(document.querySelector('details.collapsible-section')?.hasAttribute('open')).toBe(false)
  })

  it('opens duties directly and loads the selected month without the round ledger', async () => {
    window.history.replaceState({}, '', `/golf/caddies/duties?date=${OPERATION_DATE}`)
    renderPage('duties')
    expect(await screen.findByRole('heading', { name: '別業務' })).toBeTruthy()
    expect((screen.getByLabelText('対象の日') as HTMLInputElement).value).toBe(OPERATION_DATE)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'キャディを自動配置' })).toBeNull()
    expect(api.json.mock.calls.some(([path]) => path.startsWith('/v1/course/tee-sheet'))).toBe(false)
    expect(api.json.mock.calls.some(([path]) => path.includes('caddie-assignments?from=2026-08-01&to=2026-08-31'))).toBe(true)
    fireEvent.change(screen.getByLabelText('対象の日'), { target: { value: '2026-09-01' } })
    await waitFor(() => expect(api.json.mock.calls.some(([path]) => path.includes('caddie-duty-assignments?from=2026-09-01&to=2026-09-01'))).toBe(true))
  })
})
