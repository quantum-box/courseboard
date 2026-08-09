import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { LedgerBoard } from './LedgerBoard'
import type { LedgerColumn } from './models'

const COLUMN: LedgerColumn = {
  golfCourseId: 'course-1',
  courseName: '東コース',
  gridSource: 'inventory',
  groupCount: 0,
  playerCount: 0,
  selfGroupCount: 0,
  caddieGroupCount: 0,
  openSlotCount: 1,
  slots: [{
    teeTime: '07:00',
    capacity: null,
    availableGroups: null,
    bookedGroups: 0,
    playerCount: 0,
    isActive: true,
    isSellable: true,
    items: [],
  }],
}

function render(selected: boolean) {
  return renderToStaticMarkup(
    <LedgerBoard
      columns={[COLUMN]}
      nowMinutes={null}
      selection={selected ? { golfCourseId: 'course-1', teeTimes: ['07:00'] } : null}
      selectedReservationId={null}
      onToggleSlot={vi.fn()}
      onSelectReservation={vi.fn()}
      onMoveColumn={vi.fn()}
    />,
  )
}

describe('LedgerBoard empty rows', () => {
  it('makes both the time and the wide empty area buttons for the same slot', () => {
    const markup = render(false)
    expect(markup).toContain('class="ledger-time-button"')
    expect(markup).toContain('class="ledger-empty-button"')
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(2)
  })

  it('shows the same selected state on both slot buttons', () => {
    expect(render(true).match(/aria-pressed="true"/g)).toHaveLength(2)
  })
})
