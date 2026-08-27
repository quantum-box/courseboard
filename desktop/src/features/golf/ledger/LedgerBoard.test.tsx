/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import type { CoverageAssignment } from '../caddieRoundCoverage'
import type { TeeReservation } from '../timeline/models'
import { LedgerBoard } from './LedgerBoard'
import type { ResourceStatus } from './ledgerLayout'
import type { LedgerColumn } from './models'

afterEach(cleanup)

function reservation(overrides: Partial<TeeReservation> = {}): TeeReservation {
  return {
    id: 'res-1',
    reservationNumber: 'R-1',
    golfCourseId: 'course-1',
    courseName: '空沼IN',
    teeTime: '07:00',
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '本田会',
    status: 'confirmed',
    holes: 18,
    ...overrides,
  }
}

function columns(item: TeeReservation): LedgerColumn[] {
  return [
    {
      golfCourseId: 'course-1',
      courseName: '空沼IN',
      gridSource: 'inventory',
      groupCount: 1,
      playerCount: 4,
      selfGroupCount: 0,
      caddieGroupCount: 1,
      openSlotCount: 0,
      slots: [
        {
          teeTime: '07:00',
          capacity: 1,
          availableGroups: 0,
          bookedGroups: 1,
          playerCount: 4,
          isActive: true,
          isSellable: false,
          items: [item],
        },
      ],
    },
  ]
}

function renderBoard({
  item,
  shiftsConfirmed,
  assignments,
  selectedReservationId = null,
}: {
  item: TeeReservation
  shiftsConfirmed: boolean
  assignments: ResourceStatus<{ items: CoverageAssignment[] }>
  selectedReservationId?: string | null
}) {
  return render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <LedgerBoard
          columns={columns(item)}
          caddieSupply={new Map()}
          shiftsConfirmed={shiftsConfirmed}
          assignments={assignments}
          nowMinutes={null}
          selection={null}
          selectedReservationId={selectedReservationId}
          onToggleSlot={vi.fn()}
          onBookSlot={vi.fn()}
          onOpenContextMenu={vi.fn()}
          onSelectReservation={vi.fn()}
          onMoveColumn={vi.fn()}
          onOpenCourseSetup={vi.fn()}
        />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

const badgeText = () => i18next.t('ledger:cell.unassignedCaddie')

describe('LedgerBoard unassigned-caddie badge', () => {
  it('shows the badge on a confirmed day with no covering assignment', () => {
    renderBoard({
      item: reservation(),
      shiftsConfirmed: true,
      assignments: { kind: 'loaded', value: { items: [] } },
    })
    expect(screen.getByText(badgeText())).toBeTruthy()
  })

  it('hides the badge once a live assignment covers the round', () => {
    renderBoard({
      item: reservation(),
      shiftsConfirmed: true,
      assignments: {
        kind: 'loaded',
        value: { items: [{ reservationId: 'res-1', status: 'assigned' }] },
      },
    })
    expect(screen.queryByText(badgeText())).toBeNull()
  })

  it('hides the badge on a day with no confirmed shifts, even with no assignment', () => {
    renderBoard({
      item: reservation(),
      shiftsConfirmed: false,
      assignments: { kind: 'loaded', value: { items: [] } },
    })
    expect(screen.queryByText(badgeText())).toBeNull()
  })

  it('hides the badge while the assignment lookup is still unknown', () => {
    renderBoard({
      item: reservation(),
      shiftsConfirmed: true,
      assignments: { kind: 'unknown' },
    })
    expect(screen.queryByText(badgeText())).toBeNull()
  })

  it('hides the badge when the assignment lookup failed', () => {
    renderBoard({
      item: reservation(),
      shiftsConfirmed: true,
      assignments: { kind: 'failed' },
    })
    expect(screen.queryByText(badgeText())).toBeNull()
  })

  it('shows the badge again once the only assignment on the round is cancelled', () => {
    renderBoard({
      item: reservation(),
      shiftsConfirmed: true,
      assignments: {
        kind: 'loaded',
        value: { items: [{ reservationId: 'res-1', status: 'cancelled' }] },
      },
    })
    expect(screen.getByText(badgeText())).toBeTruthy()
  })

  it('never shows the badge on a self-play round', () => {
    renderBoard({
      item: reservation({ playType: 'self' }),
      shiftsConfirmed: true,
      assignments: { kind: 'loaded', value: { items: [] } },
    })
    expect(screen.queryByText(badgeText())).toBeNull()
  })

  it('keeps both is-selected and is-unassigned-caddie on a selected, unassigned row', () => {
    const { container } = renderBoard({
      item: reservation(),
      shiftsConfirmed: true,
      assignments: { kind: 'loaded', value: { items: [] } },
      selectedReservationId: 'res-1',
    })
    const cell = container.querySelector('.ledger-cell-group')
    expect(cell?.classList.contains('is-selected')).toBe(true)
    expect(cell?.classList.contains('is-unassigned-caddie')).toBe(true)
  })
})
