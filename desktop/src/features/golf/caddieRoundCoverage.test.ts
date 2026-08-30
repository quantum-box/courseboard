import { describe, expect, it } from 'vitest'

import { holdsTheRound, unassignedCaddieRounds } from './caddieRoundCoverage'

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

describe('unassignedCaddieRounds', () => {
  it('offers a caddie round nobody is on', () => {
    expect(unassignedCaddieRounds([round('r1', 'caddie')], []).map(item => item.id)).toEqual(['r1'])
  })

  it('never offers a self-play round', () => {
    expect(unassignedCaddieRounds([round('r1', 'self')], [])).toEqual([])
  })

  it('drops a round that already has somebody on it', () => {
    const covered = unassignedCaddieRounds(
      [round('r1', 'caddie'), round('r2', 'caddie')],
      [{ reservationId: 'r1', status: 'assigned' }],
    )
    expect(covered.map(item => item.id)).toEqual(['r2'])
  })

  it('counts a completed round as staffed', () => {
    // The round happened. Offering it again would double-book history.
    expect(
      unassignedCaddieRounds([round('r1', 'caddie')], [{ reservationId: 'r1', status: 'completed' }]),
    ).toEqual([])
  })

  it('brings a cancelled round back', () => {
    // Cancelled means the group has nobody, which is exactly the work here.
    expect(
      unassignedCaddieRounds(
        [round('r1', 'caddie')],
        [{ reservationId: 'r1', status: 'cancelled' }],
      ).map(item => item.id),
    ).toEqual(['r1'])
  })

  it('ignores an assignment tied to no reservation', () => {
    expect(
      unassignedCaddieRounds([round('r1', 'caddie')], [{ reservationId: null, status: 'assigned' }])
        .map(item => item.id),
    ).toEqual(['r1'])
  })
})

describe('holdsTheRound status normalization', () => {
  it.each([
    ['raw cancelled', { status: 'cancelled' }, false],
    ['raw canceled', { status: 'canceled' }, false],
    ['raw padded and uppercase cancelled', { status: '  CANCELLED  ' }, false],
    ['raw unknown', { status: 'awaiting_review' }, true],
    ['canonical cancelled', { status: 'assigned', canonicalStatus: 'cancelled' }, false],
    ['canonical overrides raw cancellation', { status: 'cancelled', canonicalStatus: 'assigned' }, true],
    ['canonical unknown remains coverage', { status: 'cancelled', canonicalStatus: 'other' }, true],
  ])('%s', (_label, assignment, expected) => {
    expect(holdsTheRound(assignment)).toBe(expected)
  })
})
