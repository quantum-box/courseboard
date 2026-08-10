/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { BudgetsPage } from './BudgetsPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <BudgetsPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('BudgetsPage achievement display', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    api.json.mockReset()
    api.json.mockImplementation(async (path: string) => {
      if (path === '/v1/course/courses') {
        return { items: [{ id: 'course-east', name: '東コース' }] }
      }
      if (path.startsWith('/v1/course/daily-budgets?')) {
        return { items: [] }
      }
      if (path.startsWith('/v1/course/daily-budgets/achievement?')) {
        return {
          items: [
            {
              date: '2026-08-07',
              targetRevenue: 0,
              actualRevenue: 0,
              // Course API omits revenueAchievementRate when the target is zero.
              targetAverageSpend: 0,
              actualAverageSpend: 0,
              targetCaddyAttachedRatio: 0,
              actualCaddyAttachedRatio: 0,
              reservationCount: 0,
              playerCount: 0,
            },
            {
              date: '2026-08-08',
              targetRevenue: 100_000,
              actualRevenue: 50_000,
              revenueAchievementRate: 0.5,
              targetAverageSpend: 10_000,
              // Course API omits actualAverageSpend when the average is unavailable.
              targetCaddyAttachedRatio: 0.5,
              actualCaddyAttachedRatio: 0.4,
              reservationCount: 1,
              playerCount: 0,
            },
            {
              date: '2026-08-09',
              targetRevenue: 100_000,
              actualRevenue: 50_000,
              revenueAchievementRate: 0.5,
              targetAverageSpend: 10_000,
              actualAverageSpend: 8_000,
              targetCaddyAttachedRatio: 0.5,
              // Course API omits actualCaddyAttachedRatio when the ratio is unavailable.
              reservationCount: 1,
              playerCount: 4,
            },
          ],
        }
      }
      throw new Error(`Unexpected API call: GET ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders an em dash instead of NaN when the revenue target is zero', async () => {
    renderPage()

    const dateCell = await screen.findByText('2026-08-07')
    const row = dateCell.closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row!).getAllByRole('cell')
    expect(cells[2]?.textContent).toBe('—')
    expect(row!.textContent).not.toContain('NaN')
  })

  it('renders an em dash instead of yen NaN when actualAverageSpend is omitted', async () => {
    renderPage()

    const dateCell = await screen.findByText('2026-08-08')
    const row = dateCell.closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row!).getAllByRole('cell')
    expect(cells[3]?.textContent).toMatch(/^— \/ /)
    expect(cells[3]?.textContent).not.toContain('NaN')
  })

  it('renders an em dash instead of NaN percent when actualCaddyAttachedRatio is omitted', async () => {
    renderPage()

    const dateCell = await screen.findByText('2026-08-09')
    const row = dateCell.closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row!).getAllByRole('cell')
    expect(cells[4]?.textContent).toMatch(/^— \/ /)
    expect(cells[4]?.textContent).not.toContain('NaN')
  })
})
