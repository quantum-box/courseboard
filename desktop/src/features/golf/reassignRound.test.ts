import { describe, expect, it } from 'vitest'

import {
  reassignBlocked,
  reassignTargets,
  type MovableAssignment,
  type MovableRoundRow,
} from './reassignRound'

function row(id: string, teeTime: string, overrides: Partial<MovableRoundRow> = {}): MovableRoundRow {
  return {
    id,
    reservationNumber: id.toUpperCase(),
    golfCourseId: 'course_out',
    courseName: 'OUT',
    teeTime,
    playType: 'caddie',
    partySize: 4,
    ...overrides,
  }
}

function assignment(
  id: string,
  caddieProfileId: string,
  reservationId: string | null,
  status = 'assigned',
): MovableAssignment {
  return { id, caddieProfileId, reservationId, status }
}

const names = new Map([
  ['cp_1', '佐藤 彩'],
  ['cp_2', '高橋 浩'],
])

describe('reassignTargets', () => {
  it('lists the day in start order and names who holds each group', () => {
    const targets = reassignTargets({
      rows: [row('rsv_2', '2026-08-29T09:00:00+09:00'), row('rsv_1', '2026-08-29T07:00:00+09:00')],
      assignments: [
        assignment('a_1', 'cp_1', 'rsv_1'),
        assignment('a_2', 'cp_2', 'rsv_2'),
      ],
      caddieNames: names,
      currentAssignmentId: 'a_1',
    })

    expect(targets.map(target => [target.reservationId, target.heldBy, target.isCurrent])).toEqual([
      ['rsv_1', null, true],
      ['rsv_2', '高橋 浩', false],
    ])
  })

  it('leaves out self-play groups and cancelled bookings', () => {
    const targets = reassignTargets({
      rows: [
        row('rsv_1', '2026-08-29T07:00:00+09:00'),
        row('rsv_self', '2026-08-29T07:10:00+09:00', { playType: 'self' }),
        row('rsv_gone', '2026-08-29T07:20:00+09:00', { status: 'cancelled' }),
      ],
      assignments: [],
      caddieNames: names,
      currentAssignmentId: 'a_1',
    })

    expect(targets.map(target => target.reservationId)).toEqual(['rsv_1'])
  })

  it('treats a cancelled assignment as leaving its group free', () => {
    const targets = reassignTargets({
      rows: [row('rsv_1', '2026-08-29T07:00:00+09:00')],
      assignments: [assignment('a_2', 'cp_2', 'rsv_1', 'cancelled')],
      caddieNames: names,
      currentAssignmentId: 'a_1',
    })

    expect(targets[0]?.heldBy).toBeNull()
  })
})

describe('reassignBlocked', () => {
  const free = {
    reservationId: 'rsv_2',
    teeTime: '2026-08-29T09:00:00+09:00',
    courseName: 'OUT',
    golfCourseId: 'course_out',
    partyLabel: 'RSV_2',
    partySize: 4,
    heldBy: null,
    isCurrent: false,
  }

  it('says nothing about a free group somebody is actually being moved to', () => {
    expect(reassignBlocked({
      target: free,
      caddieProfileId: 'cp_1',
      currentCaddieProfileId: 'cp_1',
    })).toBeNull()
  })

  it('names what the API would refuse', () => {
    expect(reassignBlocked({
      target: null,
      caddieProfileId: 'cp_1',
      currentCaddieProfileId: 'cp_1',
    })).toBe('noTarget')
    expect(reassignBlocked({
      target: { ...free, heldBy: '高橋 浩' },
      caddieProfileId: 'cp_1',
      currentCaddieProfileId: 'cp_1',
    })).toBe('taken')
    expect(reassignBlocked({
      target: { ...free, isCurrent: true },
      caddieProfileId: 'cp_1',
      currentCaddieProfileId: 'cp_1',
    })).toBe('unchanged')
  })

  it('lets the same group through when the caddie is the thing that changed', () => {
    expect(reassignBlocked({
      target: { ...free, isCurrent: true },
      caddieProfileId: 'cp_2',
      currentCaddieProfileId: 'cp_1',
    })).toBeNull()
  })
})
