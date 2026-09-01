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

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CaddiesPage initialView="dispatch" />
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

  it('starts on the unassigned workflow with secondary information collapsed', async () => {
    renderPage()

    const roundTab = await screen.findByRole('tab', { name: /ラウンド配置/ })
    const dutyTab = screen.getByRole('tab', { name: /別業務/ })
    const dateInput = screen.getByLabelText('対象の日')
    expect(roundTab.getAttribute('aria-selected')).toBe('true')
    expect(dutyTab.getAttribute('aria-selected')).toBe('false')
    expect(roundTab.className).toContain('bg-primary')
    expect(dutyTab.className).toContain('bg-background')
    expect(roundTab.compareDocumentPosition(dateInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(screen.getByRole('heading', { name: '未配置を解消する' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'キャディが決まっていない組' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /自動.*配置/ })).toBeTruthy()
    const assigned = document.querySelector('details.collapsible-section')
    expect(assigned).toBeTruthy()
    expect(assigned?.hasAttribute('open')).toBe(false)
    expect(screen.queryByRole('heading', { name: '別業務' })).toBeNull()
  })

  it('switches to non-round work while keeping the operation date', async () => {
    renderPage()

    const dateInput = await screen.findByLabelText('対象の日') as HTMLInputElement
    expect(dateInput.value).toBe(OPERATION_DATE)

    fireEvent.click(await screen.findByRole('tab', { name: /別業務/ }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /別業務/ }).getAttribute('aria-selected')).toBe('true')
    })

    expect(screen.getByRole('heading', { name: '別業務' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /未配置/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: /自動.*配置/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'この日の割当' })).toBeNull()
    expect((screen.getByLabelText('対象の日') as HTMLInputElement).value).toBe(OPERATION_DATE)
    expect(new URL(window.location.href).searchParams.get('date')).toBe(OPERATION_DATE)
    expect(new URL(window.location.href).searchParams.get('tab')).toBe('duties')
  })

  it('keeps keyboard navigation and the URL tab state in sync', async () => {
    renderPage()

    const roundTab = await screen.findByRole('tab', { name: /ラウンド配置/ })
    fireEvent.keyDown(roundTab, { key: 'ArrowRight' })

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /別業務/ }).getAttribute('aria-selected')).toBe('true')
      expect(new URL(window.location.href).searchParams.get('tab')).toBe('duties')
    })
    expect(screen.getByRole('tab', { name: /別業務/ }).getAttribute('tabindex')).toBe('0')
    expect(roundTab.getAttribute('tabindex')).toBe('-1')
  })
})
