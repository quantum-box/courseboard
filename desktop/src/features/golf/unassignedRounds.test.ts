import { describe, expect, it } from 'vitest'

import {
  assignmentsOnCancelledRounds,
  dayLabel,
  horizonEnd,
  wallClock,
} from './UnassignedRounds'

function round(id: string, playType: string, status?: string) {
  return {
    id,
    reservationNumber: `RSV-${id}`,
    golfCourseId: 'course-out',
    courseName: '羊ヶ丘',
    teeTime: '2026-08-08T07:00:00+09:00',
    playType,
    partySize: 4,
    ...(status === undefined ? {} : { status }),
  }
}

describe('assignmentsOnCancelledRounds', () => {
  it('finds a caddie left on a group that is gone from the sheet', () => {
    const left = assignmentsOnCancelledRounds(
      [round('r1', 'caddie')],
      [
        { id: 'a1', reservationId: 'r1', status: 'assigned' },
        { id: 'a2', reservationId: 'r_gone', status: 'assigned' },
      ],
    )
    expect(left.map(item => item.id)).toEqual(['a2'])
  })

  it('reads a cancelled row on the sheet as a group nobody plays', () => {
    // Whether the upstream drops a cancelled booking or returns it marked,
    // the caddie standing on it is the same problem.
    const left = assignmentsOnCancelledRounds(
      [round('r1', 'caddie', 'cancelled')],
      [{ id: 'a1', reservationId: 'r1', status: 'assigned' }],
    )
    expect(left.map(item => item.id)).toEqual(['a1'])
  })

  it('leaves an assignment that was already cancelled alone', () => {
    expect(
      assignmentsOnCancelledRounds(
        [round('r1', 'caddie')],
        [{ id: 'a1', reservationId: 'r_gone', status: 'cancelled' }],
      ),
    ).toEqual([])
  })

  it('says nothing about an assignment tied to no reservation', () => {
    expect(
      assignmentsOnCancelledRounds(
        [round('r1', 'caddie')],
        [{ id: 'a1', reservationId: null, status: 'assigned' }],
      ),
    ).toEqual([])
  })

  it('accuses nobody when the sheet is empty', () => {
    // An empty sheet is a failed or unfinished fetch as often as a quiet day,
    // and every assignment would look orphaned against it.
    expect(
      assignmentsOnCancelledRounds([], [{ id: 'a1', reservationId: 'r1', status: 'assigned' }]),
    ).toEqual([])
  })
})

describe('wallClock', () => {
  it('reads the course clock off the stamp', () => {
    expect(wallClock('2026-08-08T07:00:00+09:00')).toBe('07:00')
  })

  it('leaves something it cannot read alone', () => {
    expect(wallClock('unknown')).toBe('unknown')
  })
})

describe('horizonEnd', () => {
  it('keeps a one-day horizon on its own day', () => {
    expect(horizonEnd('2026-08-08', 1)).toBe('2026-08-08')
  })

  it('counts the chosen day as the first of the horizon', () => {
    // A week from the 8th ends on the 14th, not the 15th.
    expect(horizonEnd('2026-08-08', 7)).toBe('2026-08-14')
  })

  it('crosses a month end', () => {
    expect(horizonEnd('2026-08-25', 14)).toBe('2026-09-07')
  })
})

describe('dayLabel', () => {
  it('names the day on the course clock', () => {
    expect(dayLabel('2026-08-08T07:00:00+09:00')).toBe('8/8(土)')
  })

  it('leaves something it cannot read alone', () => {
    expect(dayLabel('unknown')).toBe('unknown')
  })
})
