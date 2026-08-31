/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../i18n'
import { AssignmentsTable, type CaddieAssignment, type CaddieProfile } from './CaddiesPage'

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

function assignment(id: string, caddieProfileId: string, scheduledAt: string): CaddieAssignment {
  return {
    id,
    caddieProfileId,
    reservationId: `rsv-${id}`,
    roundReference: `R-${id}`,
    scheduledAt,
    status: 'assigned',
    assignmentRole: 'primary',
    feeAmount: 12000,
    feeCurrency: 'JPY',
  }
}

function profile(id: string, displayName: string): CaddieProfile {
  return {
    id,
    displayName,
    employmentStatus: 'active',
    skillLevel: 'regular',
    baseFeeAmount: 12000,
    currency: 'JPY',
    maxRoundsPerDay: 2,
    ratingCount: 0,
  }
}

const PROFILES = [profile('cad_keen', '佐藤 彩'), profile('cad_plain', '渡辺 健')]

function renderTable() {
  return render(
    <I18nextProvider i18n={i18next}>
      <AssignmentsTable
        assignments={[
          assignment('a1', 'cad_keen', '2026-08-08T07:00:00+09:00'),
          assignment('a2', 'cad_keen', '2026-08-08T13:00:00+09:00'),
          assignment('b1', 'cad_plain', '2026-08-08T08:00:00+09:00'),
        ]}
        profiles={PROFILES}
        twoRoundRequests={new Set(['cad_keen'])}
        onChanged={vi.fn()}
        setFlash={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('the day board marks two-round days', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('marks the second round of the day and leaves the first alone', () => {
    const { container } = renderTable()

    // One row of the three: the caddie's later round, not their earlier one
    // and not the other caddie's single round.
    const marked = container.querySelectorAll('tr.second-round-row')
    expect(marked).toHaveLength(1)
    expect(marked[0].textContent).toContain('R-a2')
    expect(screen.getAllByText('2R目')).toHaveLength(1)
  })

  it('badges the caddie who asked for two rounds on every round they hold', () => {
    renderTable()

    expect(screen.getAllByText('2R希望')).toHaveLength(2)
  })
})
