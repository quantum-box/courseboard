import { describe, expect, it } from 'vitest'

import type { CourseCaddieSupply } from '../caddieCourseSupply'
import type { CoverageAssignment } from '../caddieRoundCoverage'
import type { TeeReservation } from '../timeline/models'
import type { LedgerColumn, LedgerSlot } from './models'
import {
  currentSlotTeeTime,
  DEFAULT_SEAT_COLUMNS,
  MAX_SEAT_COLUMNS,
  dayHasConfirmedShifts,
  formatCaddieCapacity,
  formatCaddieShortfall,
  groupTitle,
  knowsCaddieCapacity,
  knowsRemainingCapacity,
  observedIntervalMinutes,
  remainingGroups,
  resourceStatus,
  seatCells,
  seatColumnCount,
  slotTone,
  sortSlots,
  summarizeLedger,
  teeTimeMinutes,
  teeTimesBetween,
  unassignedCaddieReservationIds,
  type ResourceStatus,
} from './ledgerLayout'

function reservation(overrides: Partial<TeeReservation> = {}): TeeReservation {
  return {
    id: 'res-1',
    reservationNumber: 'R-1',
    golfCourseId: 'course-1',
    courseName: '空沼IN',
    teeTime: '2026-07-20T07:00:00+09:00',
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '本田会',
    status: 'confirmed',
    holes: 18,
    ...overrides,
  }
}

function slot(overrides: Partial<LedgerSlot> = {}): LedgerSlot {
  return {
    teeTime: '07:00',
    capacity: 3,
    availableGroups: 2,
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
    courseName: '空沼IN',
    gridSource: 'inventory',
    groupCount: 0,
    playerCount: 0,
    selfGroupCount: 0,
    caddieGroupCount: 0,
    openSlotCount: 0,
    slots: [],
    ...overrides,
  }
}

describe('slotTone', () => {
  it('shows a row the desk shut as closed rather than merely full', () => {
    const closed = slot({
      bookedGroups: 0,
      isSellable: false,
      mark: { golfCourseId: 'course-1', date: '2026-07-20', teeTime: '07:00', kind: 'closed' },
    })
    expect(slotTone(closed)).toBe('closed')
  })

  it('separates a retired row from one the desk closed', () => {
    // Both are unsellable, but only one of them was somebody's decision.
    const retired = slot({ isActive: false, isSellable: false })
    expect(slotTone(retired)).toBe('retired')
  })

  it('marks a special-rate row without pretending it is unsellable', () => {
    const special = slot({
      mark: {
        golfCourseId: 'course-1',
        date: '2026-07-20',
        teeTime: '07:00',
        kind: 'special_rate',
        label: '特別料金',
      },
    })
    expect(slotTone(special)).toBe('special')
  })

  it('calls an untouched row open and a sold-out one full', () => {
    expect(slotTone(slot({ bookedGroups: 0 }))).toBe('open')
    expect(slotTone(slot({ bookedGroups: 3, availableGroups: 0, isSellable: false }))).toBe('full')
  })

  it('calls a row with room left beside a booking partial', () => {
    expect(slotTone(slot({ bookedGroups: 1, availableGroups: 2, isSellable: true }))).toBe('partial')
  })
})

describe('remainingGroups', () => {
  it('keeps "nobody counted" apart from "none left"', () => {
    // Collapsing these would show every open tee time on an ungenerated course
    // as full.
    expect(remainingGroups(slot({ availableGroups: null }))).toBeNull()
    expect(remainingGroups(slot({ availableGroups: 0 }))).toBe(0)
  })

  it('never reports a negative remainder when Field oversold a row', () => {
    expect(remainingGroups(slot({ availableGroups: -1 }))).toBe(0)
  })
})

describe('seatColumnCount', () => {
  it('draws four seats for a course that only sells four-balls', () => {
    const withFours = column({ slots: [slot({ items: [reservation()] })] })
    expect(seatColumnCount(withFours)).toBe(DEFAULT_SEAT_COLUMNS)
  })

  it('widens for the largest group rather than cutting a player off the sheet', () => {
    const withFive = column({ slots: [slot({ items: [reservation({ partySize: 5 })] })] })
    expect(seatColumnCount(withFive)).toBe(5)
  })

  it('stops at the ceiling the API enforces', () => {
    const absurd = column({ slots: [slot({ items: [reservation({ partySize: 40 })] })] })
    expect(seatColumnCount(absurd)).toBe(MAX_SEAT_COLUMNS)
  })

  it('keeps four seats on an empty day instead of collapsing the grid', () => {
    expect(seatColumnCount(column())).toBe(DEFAULT_SEAT_COLUMNS)
  })
})

describe('seatCells', () => {
  it('tells an unfilled seat apart from one that is not part of the group', () => {
    // Blank-for-both would have the desk chasing names on a three-ball's
    // imaginary fourth seat.
    const threeBall = reservation({
      partySize: 3,
      party: { players: [{ name: '増田 公陽' }] },
    })
    expect(seatCells(threeBall, 4).map(cell => cell.kind)).toEqual([
      'player',
      'unnamed',
      'unnamed',
      'empty',
    ])
  })

  it('carries the rate tag through so the desk sees it above the name', () => {
    const item = reservation({ party: { players: [{ name: '増田 公陽', tag: '共通' }] } })
    expect(seatCells(item, 4)[0]).toEqual({ kind: 'player', name: '増田 公陽', tag: '共通' })
  })

  it('shows every name even when more were entered than the booking counted', () => {
    const item = reservation({
      partySize: 2,
      party: { players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
    })
    const kinds = seatCells(item, 4).map(cell => cell.kind)
    expect(kinds).toEqual(['player', 'player', 'player', 'empty'])
  })
})

describe('groupTitle', () => {
  it('leads with the competition, which is how a competition day is worked', () => {
    const item = reservation({ party: { competitionName: '本田会', groupNumber: 1, players: [] } })
    expect(groupTitle(item)).toContain('本田会')
    expect(groupTitle(item)).toContain('1')
  })

  it('falls back to the booking name when there is no competition', () => {
    expect(groupTitle(reservation({ partyName: '中川 伸一' }))).toBe('中川 伸一')
  })

  it('does not print a group number nobody set', () => {
    const item = reservation({ party: { competitionName: '本田会', players: [] } })
    expect(groupTitle(item)).toBe('本田会')
  })
})

describe('teeTimesBetween', () => {
  const slots = [slot({ teeTime: '07:00' }), slot({ teeTime: '07:07' }), slot({ teeTime: '07:14' })]

  it('takes the whole band whichever end was clicked first', () => {
    expect(teeTimesBetween(slots, '07:00', '07:14')).toEqual(['07:00', '07:07', '07:14'])
    expect(teeTimesBetween(slots, '07:14', '07:00')).toEqual(['07:00', '07:07', '07:14'])
  })

  it('is just the one row when both ends are the same', () => {
    expect(teeTimesBetween(slots, '07:07', '07:07')).toEqual(['07:07'])
  })

  it('selects nothing when an end is not on the board', () => {
    expect(teeTimesBetween(slots, '07:00', '09:99')).toEqual([])
  })
})

describe('currentSlotTeeTime', () => {
  const slots = [slot({ teeTime: '07:00' }), slot({ teeTime: '07:07' }), slot({ teeTime: '07:14' })]

  it('sits on the last row that has already teed off', () => {
    // Marking the next row instead would draw the line above a group that is
    // already out on the course.
    expect(currentSlotTeeTime(slots, 7 * 60 + 10)).toBe('07:07')
  })

  it('sits nowhere before the first start', () => {
    expect(currentSlotTeeTime(slots, 6 * 60)).toBeNull()
  })

  it('sits on the last row once the day is past it', () => {
    expect(currentSlotTeeTime(slots, 20 * 60)).toBe('07:14')
  })

  it('sits nowhere on a day that is not today', () => {
    expect(currentSlotTeeTime(slots, null)).toBeNull()
  })
})

describe('teeTimeMinutes', () => {
  it('reads a wall clock and refuses anything else', () => {
    expect(teeTimeMinutes('07:14')).toBe(434)
    expect(teeTimeMinutes('7:14')).toBeNull()
    expect(teeTimeMinutes('24:00')).toBeNull()
    expect(teeTimeMinutes('')).toBeNull()
  })
})

describe('sortSlots', () => {
  it('puts rows in clock order without disturbing the caller', () => {
    const unsorted = [slot({ teeTime: '07:14' }), slot({ teeTime: '06:53' })]
    expect(sortSlots(unsorted).map(entry => entry.teeTime)).toEqual(['06:53', '07:14'])
    expect(unsorted[0]!.teeTime).toBe('07:14')
  })
})

describe('summarizeLedger', () => {
  it('adds up the day across every column', () => {
    const total = summarizeLedger([
      column({ groupCount: 26, playerCount: 92, selfGroupCount: 10, caddieGroupCount: 16, openSlotCount: 4 }),
      column({ groupCount: 18, playerCount: 58, selfGroupCount: 12, caddieGroupCount: 6, openSlotCount: 9 }),
    ])
    expect(total).toEqual({
      groups: 44,
      players: 150,
      selfGroups: 22,
      caddieGroups: 22,
      openSlots: 13,
      uncountedCourses: 0,
    })
  })

  it('is all zeroes on a day with no columns rather than undefined', () => {
    expect(summarizeLedger([])).toEqual({
      groups: 0,
      players: 0,
      selfGroups: 0,
      caddieGroups: 0,
      openSlots: 0,
      uncountedCourses: 0,
    })
  })

  it('leaves out the open slots of a column that cannot count them', () => {
    // A club whose courses had no generated inventory read "空き枠 106 枠" on a
    // day it could not sell one tee time — every column header said the count
    // was unknown while the day total spoke for them anyway.
    const total = summarizeLedger([
      column({ gridSource: 'inventory', groupCount: 3, openSlotCount: 4 }),
      column({ gridSource: 'schedule', groupCount: 2, openSlotCount: 53 }),
    ])
    expect(total.openSlots).toBe(4)
    expect(total.uncountedCourses).toBe(1)
    // Bookings and players are counted from the rows themselves, so those stay
    // whole across both columns.
    expect(total.groups).toBe(5)
  })

  it('counts nothing when no column can count, and says how many were skipped', () => {
    const total = summarizeLedger([
      column({ gridSource: 'schedule', openSlotCount: 53 }),
      column({ gridSource: 'opening_hours', openSlotCount: 53 }),
    ])
    expect(total.openSlots).toBe(0)
    expect(total.uncountedCourses).toBe(2)
  })
})

describe('observedIntervalMinutes', () => {
  function columnWith(teeTimes: string[], gridSource: LedgerColumn['gridSource'] = 'inventory') {
    return {
      golfCourseId: 'c1',
      courseName: '羊ヶ丘',
      gridSource,
      startIntervalMinutes: 7,
      groupCount: 0,
      playerCount: 0,
      selfGroupCount: 0,
      caddieGroupCount: 0,
      openSlotCount: teeTimes.length,
      slots: teeTimes.map(teeTime => ({
        teeTime,
        bookedGroups: 0,
        playerCount: 0,
        isActive: true,
        isSellable: true,
        items: [],
      })),
    } as unknown as LedgerColumn
  }

  it('measures the gap the rows are actually drawn at', () => {
    // The course record says 7; the opening bands generated every 8. The label
    // has to match the rows, not the record.
    expect(observedIntervalMinutes(columnWith(['07:00', '07:08', '07:16']))).toBe(8)
  })

  it('says nothing when the board changes pace', () => {
    expect(observedIntervalMinutes(columnWith(['07:00', '07:08', '07:20']))).toBeNull()
  })

  it('says nothing when there is not enough board to measure', () => {
    expect(observedIntervalMinutes(columnWith(['07:00']))).toBeNull()
    expect(observedIntervalMinutes(columnWith([]))).toBeNull()
  })
})

describe('knowsRemainingCapacity', () => {
  it('only generated inventory counts groups left', () => {
    const slots = ['07:00', '07:08']
    expect(knowsRemainingCapacity(columnFor('inventory', slots))).toBe(true)
    expect(knowsRemainingCapacity(columnFor('opening_hours', slots))).toBe(false)
    expect(knowsRemainingCapacity(columnFor('bookings_only', slots))).toBe(false)
  })

  function columnFor(gridSource: LedgerColumn['gridSource'], teeTimes: string[]) {
    return {
      gridSource,
      startIntervalMinutes: 7,
      openSlotCount: teeTimes.length,
      slots: teeTimes.map(teeTime => ({ teeTime, items: [] })),
    } as unknown as LedgerColumn
  }
})

describe('knowsCaddieCapacity', () => {
  it('says nothing about a course whose month was never confirmed', () => {
    // Every field arrives at zero when no shift rows exist, and "0/0" would
    // read as a limit somebody set.
    const unconfirmed = supply({
      workingCaddies: 0,
      roundsCapacity: 0,
      caddieAttachedGroups: 0,
      movableCaddies: 0,
      shortfall: 0,
    })
    expect(knowsCaddieCapacity(unconfirmed)).toBe(false)
  })

  it('speaks up when groups are sold against no confirmed shifts', () => {
    // Capacity nobody set, bookings that do exist: the one case where zero
    // capacity is worth printing.
    const oversold = supply({ roundsCapacity: 0, caddieAttachedGroups: 3, shortfall: -3 })
    expect(knowsCaddieCapacity(oversold)).toBe(true)
  })

  it('is quiet while the lookup is still out', () => {
    expect(knowsCaddieCapacity(null)).toBe(false)
    expect(knowsCaddieCapacity(undefined)).toBe(false)
  })
})

describe('resourceStatus', () => {
  it('is unknown while the load has not landed', () => {
    expect(resourceStatus({ data: null, error: null, loading: true })).toEqual({ kind: 'unknown' })
  })

  it('is failed once the loader threw', () => {
    expect(resourceStatus({ data: null, error: new Error('boom'), loading: false }))
      .toEqual({ kind: 'failed' })
  })

  it('is loaded once data has arrived', () => {
    expect(resourceStatus({ data: { items: [] }, error: null, loading: false }))
      .toEqual({ kind: 'loaded', value: { items: [] } })
  })

  it('prefers failed over data left over from before the error', () => {
    // A revalidation that fails keeps the last good page on screen, but the
    // status itself must still say the read is not to be trusted.
    expect(resourceStatus({ data: { items: [] }, error: new Error('boom'), loading: false }))
      .toEqual({ kind: 'failed' })
  })
})

describe('dayHasConfirmedShifts', () => {
  it('is true once at least one shift is confirmed', () => {
    expect(dayHasConfirmedShifts({ kind: 'loaded', value: { items: [{}] } })).toBe(true)
  })

  it('is false on a day with zero confirmed shifts', () => {
    expect(dayHasConfirmedShifts({ kind: 'loaded', value: { items: [] } })).toBe(false)
  })

  it('is false while the lookup is unknown or failed', () => {
    expect(dayHasConfirmedShifts({ kind: 'unknown' })).toBe(false)
    expect(dayHasConfirmedShifts({ kind: 'failed' })).toBe(false)
  })
})

describe('unassignedCaddieReservationIds', () => {
  function coverageColumn(golfCourseId: string, items: TeeReservation[]): LedgerColumn {
    return column({ golfCourseId, slots: [slot({ items })] })
  }

  it('includes a caddie round with no assignment covering it', () => {
    const columns = [coverageColumn('course-1', [reservation({ id: 'r1', playType: 'caddie' })])]
    const ids = unassignedCaddieReservationIds(columns, {
      kind: 'loaded',
      value: { items: [] },
    })
    expect(ids.has('r1')).toBe(true)
  })

  it('leaves out a self-play round regardless of assignments', () => {
    const columns = [coverageColumn('course-1', [reservation({ id: 'r1', playType: 'self' })])]
    const ids = unassignedCaddieReservationIds(columns, {
      kind: 'loaded',
      value: { items: [] },
    })
    expect(ids.has('r1')).toBe(false)
  })

  it('treats a cancelled assignment as no coverage at all', () => {
    const columns = [coverageColumn('course-1', [reservation({ id: 'r1', playType: 'caddie' })])]
    const ids = unassignedCaddieReservationIds(columns, {
      kind: 'loaded',
      value: { items: [{ reservationId: 'r1', status: 'cancelled' }] },
    })
    expect(ids.has('r1')).toBe(true)
  })

  it('gathers rounds across more than one column into a single set', () => {
    const columns = [
      coverageColumn('course-1', [reservation({ id: 'r1', playType: 'caddie' })]),
      coverageColumn('course-2', [reservation({ id: 'r2', playType: 'caddie' })]),
    ]
    const assignments: ResourceStatus<{ items: CoverageAssignment[] }> = {
      kind: 'loaded',
      value: { items: [{ reservationId: 'r1', status: 'assigned' }] },
    }
    const ids = unassignedCaddieReservationIds(columns, assignments)
    expect(ids).toEqual(new Set(['r2']))
  })

  it('returns an empty set when the assignment lookup is unknown or failed', () => {
    const columns = [coverageColumn('course-1', [reservation({ id: 'r1', playType: 'caddie' })])]
    expect(unassignedCaddieReservationIds(columns, { kind: 'unknown' })).toEqual(new Set())
    expect(unassignedCaddieReservationIds(columns, { kind: 'failed' })).toEqual(new Set())
  })
})

describe('formatCaddieCapacity', () => {
  it('reads sold over what the day can take', () => {
    const line = formatCaddieCapacity(supply({ roundsCapacity: 12, caddieAttachedGroups: 8 }))
    expect(line).toContain('8')
    expect(line).toContain('12')
  })
})

describe('formatCaddieShortfall', () => {
  it('spells out the groups still sellable rather than leaving a subtraction', () => {
    expect(formatCaddieShortfall(supply({ shortfall: 4 }))).toContain('4')
  })

  it('states the overshoot as a positive count, not a minus sign', () => {
    // "-2 組" beside a ratio is read as a tally, not as a warning.
    const line = formatCaddieShortfall(supply({ shortfall: -2 }))
    expect(line).toContain('2')
    expect(line).not.toContain('-')
  })
})

function supply(overrides: Partial<CourseCaddieSupply> = {}): CourseCaddieSupply {
  return {
    golfCourseId: 'course-1',
    courseName: '空沼IN',
    workingCaddies: 7,
    roundsCapacity: 12,
    caddieAttachedGroups: 8,
    movableCaddies: 2,
    shortfall: 4,
    ...overrides,
  }
}
