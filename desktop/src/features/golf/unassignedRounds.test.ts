import { describe, expect, it } from 'vitest'

import { unassignedCaddieRounds, wallClock } from './UnassignedRounds'

function round(id: string, playType: string) {
  return {
    id,
    reservationNumber: `RSV-${id}`,
    courseName: '羊ヶ丘',
    teeTime: '2026-08-08T07:00:00+09:00',
    playType,
    partySize: 4,
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

describe('wallClock', () => {
  it('reads the course clock off the stamp', () => {
    expect(wallClock('2026-08-08T07:00:00+09:00')).toBe('07:00')
  })

  it('leaves something it cannot read alone', () => {
    expect(wallClock('unknown')).toBe('unknown')
  })
})
