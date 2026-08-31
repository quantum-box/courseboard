import { describe, expect, it } from 'vitest'

import { secondRoundAssignmentIds, twoRoundRequestIds } from './twoRoundDay'

function assignment(id: string, caddieProfileId: string, scheduledAt: string, status = 'assigned') {
  return { id, caddieProfileId, scheduledAt, status }
}

describe('secondRoundAssignmentIds', () => {
  it('names the later round of a pair, not the earlier one', () => {
    const second = secondRoundAssignmentIds([
      assignment('a2', 'cad_1', '2026-08-08T14:00:00+09:00'),
      assignment('a1', 'cad_1', '2026-08-08T07:00:00+09:00'),
    ])

    expect(second).toEqual(new Set(['a2']))
  })

  it('counts each caddie on their own', () => {
    const second = secondRoundAssignmentIds([
      assignment('a1', 'cad_1', '2026-08-08T07:00:00+09:00'),
      assignment('b1', 'cad_2', '2026-08-08T14:00:00+09:00'),
    ])

    expect(second.size).toBe(0)
  })

  it('does not promote a round because the one before it was cancelled', () => {
    // The caddie is walking one round, which is the shortfall the board is
    // there to show — calling it a second would hide it.
    const second = secondRoundAssignmentIds([
      assignment('a1', 'cad_1', '2026-08-08T07:00:00+09:00', 'cancelled'),
      assignment('a2', 'cad_1', '2026-08-08T14:00:00+09:00'),
    ])

    expect(second.size).toBe(0)
  })

  it('marks a third round as well, so nothing goes unlabelled', () => {
    const second = secondRoundAssignmentIds([
      assignment('a1', 'cad_1', '2026-08-08T07:00:00+09:00'),
      assignment('a2', 'cad_1', '2026-08-08T12:00:00+09:00'),
      assignment('a3', 'cad_1', '2026-08-08T16:00:00+09:00'),
    ])

    expect(second).toEqual(new Set(['a2', 'a3']))
  })
})

describe('twoRoundRequestIds', () => {
  it('keeps only the caddies who asked', () => {
    const asked = twoRoundRequestIds([
      { caddieProfileId: 'cad_1', twoRoundRequest: true },
      { caddieProfileId: 'cad_2', twoRoundRequest: false },
      { caddieProfileId: 'cad_3' },
    ])

    expect(asked).toEqual(new Set(['cad_1']))
  })
})
