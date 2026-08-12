import { describe, expect, it } from 'vitest'

import type { LedgerColumn, LedgerSlot } from './models'
import {
  blockFixRoute,
  courseSetupRoute,
  reservationBlockReason,
  reservationTarget,
  selectedReservationTarget,
} from './newReservation'

function slot(overrides: Partial<LedgerSlot> = {}): LedgerSlot {
  return {
    teeTime: '07:00',
    capacity: 2,
    availableGroups: 1,
    bookedGroups: 1,
    playerCount: 4,
    isActive: true,
    isSellable: true,
    items: [],
    ...overrides,
  }
}

function column(overrides: Partial<LedgerColumn> = {}): LedgerColumn {
  return {
    golfCourseId: 'course-1',
    courseName: '東コース',
    resourceId: 'resource-1',
    gridSource: 'inventory',
    groupCount: 0,
    playerCount: 0,
    selfGroupCount: 0,
    caddieGroupCount: 0,
    openSlotCount: 1,
    slots: [slot()],
    ...overrides,
  }
}

describe('ledger reservation availability', () => {
  it('resolves a row directly or from exactly one selected tee time', () => {
    expect(reservationTarget([column()], 'course-1', '07:00')?.column.resourceId)
      .toBe('resource-1')
    expect(selectedReservationTarget(
      [column()],
      { golfCourseId: 'course-1', teeTimes: ['07:00'] },
    )?.slot.teeTime).toBe('07:00')
    expect(selectedReservationTarget(
      [column()],
      { golfCourseId: 'course-1', teeTimes: ['07:00', '07:08'] },
    )).toBeNull()
  })

  it('allows a sellable generated inventory row', () => {
    expect(reservationBlockReason({ column: column(), slot: slot() })).toBeNull()
  })

  it('distinguishes full, stopped, missing resource, and not-for-sale rows', () => {
    expect(reservationBlockReason({
      column: column(),
      slot: slot({ availableGroups: 0, isSellable: false }),
    })).toBe('full')
    expect(reservationBlockReason({
      column: column(),
      slot: slot({ isActive: false, isSellable: false }),
    })).toBe('stopped')
    expect(reservationBlockReason({
      column: column({ resourceId: null }),
      slot: slot(),
    })).toBe('missingResource')
    expect(reservationBlockReason({
      column: column(),
      slot: slot({ isSellable: false }),
    })).toBe('notSellable')
  })

  it.each(['schedule', 'opening_hours'] as const)(
    'blocks a %s row because it is not generated inventory',
    gridSource => {
      expect(reservationBlockReason({
        column: column({ gridSource }),
        slot: slot({ capacity: null, availableGroups: null }),
      })).toBe('missingInventory')
    },
  )

  it('explains an explicit stop before a missing-inventory setup problem', () => {
    expect(reservationBlockReason({
      column: column({ gridSource: 'schedule' }),
      slot: slot({
        capacity: null,
        availableGroups: null,
        isSellable: false,
        mark: {
          golfCourseId: 'course-1',
          date: '2026-08-09',
          teeTime: '07:00',
          kind: 'closed',
        },
      }),
    })).toBe('stopped')
  })
})

describe('where a block is put right', () => {
  it.each(['missingInventory', 'missingResource'] as const)(
    'sends %s to the course that owns the slots',
    reason => {
      expect(blockFixRoute(reason, 'course-1')).toBe('golf/courses/course-1')
    },
  )

  it.each(['full', 'stopped', 'notSellable'] as const)(
    'offers nothing to open for %s, which is about this row today',
    reason => {
      expect(blockFixRoute(reason, 'course-1')).toBeNull()
    },
  )

  it('escapes a course id that would otherwise break the route', () => {
    expect(courseSetupRoute('course/1 2')).toBe('golf/courses/course%2F1%202')
  })
})
