import { describe, expect, it } from 'vitest'
import {
  attendanceLookup,
  clockRequestBody,
  offDutyCandidates,
  offDutyReason,
  readableRationale,
} from './CaddiesPage'

describe('readableRationale', () => {
  it('rewrites the debug tokens the production API actually returns', () => {
    // Observed verbatim on courseboard.txcloud.app.
    const reasons = readableRationale([
      'rating_count=0',
      'rounds_assigned_today=0',
      'no historical ratings yet; neutral score applied',
    ])

    expect(reasons).toContain('評価の記録なし')
    expect(reasons).toContain('今日の担当 0R')
    expect(reasons.some(reason => reason.includes('rating_count'))).toBe(false)
    expect(reasons.some(reason => reason.includes('rounds_assigned_today'))).toBe(false)
  })

  it('keeps prose it cannot translate rather than inventing a reason', () => {
    const reasons = readableRationale(['veteran preferred for full foursome'])
    expect(reasons).toEqual(['veteran preferred for full foursome'])
  })

  it('unpacks an unknown token instead of dropping it', () => {
    expect(readableRationale(['fairness_index=0.42'])).toEqual(['fairness_index: 0.42'])
  })

  it('passes localized upstream copy through untouched', () => {
    expect(readableRationale(['評価が高い', '午前帯が空いている']))
      .toEqual(['評価が高い', '午前帯が空いている'])
  })

  it('drops blanks and duplicates', () => {
    expect(readableRationale(['  ', 'rating_count=0', 'rating_count=0'])).toEqual(['評価の記録なし'])
  })
})

describe('offDutyReason', () => {
  it('says nothing about a caddie who is on duty', () => {
    expect(offDutyReason('working')).toBeNull()
  })

  it('names why a candidate is not on duty', () => {
    expect(offDutyReason('not_clocked')).toBe('notClocked')
    expect(offDutyReason('clocked_out')).toBe('clockedOut')
    expect(offDutyReason('not_linked')).toBe('notLinked')
  })

  it('treats a caddie missing from the snapshot as not clocked in', () => {
    // The snapshot is what a clock-in writes to, so absence is the safe read.
    expect(offDutyReason(undefined)).toBe('notClocked')
  })
})

describe('offDutyCandidates', () => {
  const attendance = attendanceLookup([
    { caddieProfileId: 'a', displayName: 'A', attendanceStatus: 'working', todayAssignments: 0, roundsWithoutClockInToday: 0 },
    { caddieProfileId: 'b', displayName: 'B', attendanceStatus: 'not_clocked', todayAssignments: 0, roundsWithoutClockInToday: 0 },
  ])

  it('reports only the candidates who are not on duty', () => {
    const flagged = offDutyCandidates(
      [{ caddieProfileId: 'a' }, { caddieProfileId: 'b' }, { caddieProfileId: 'c' }],
      attendance,
    )
    expect(flagged.map(entry => entry.candidate.caddieProfileId)).toEqual(['b', 'c'])
    expect(flagged.map(entry => entry.reason)).toEqual(['notClocked', 'notClocked'])
  })

  it('keeps them in the plan rather than filtering them out', () => {
    // The morning plan is drawn up before anyone has clocked in; filtering
    // would leave the dispatch board empty every day.
    const candidates = [{ caddieProfileId: 'b' }]
    expect(offDutyCandidates(candidates, attendance)).toHaveLength(1)
    expect(candidates).toHaveLength(1)
  })
})

describe('clockRequestBody', () => {
  it('always names the working day the punch belongs to', () => {
    // Field files attendance under the UTC calendar date unless told which
    // working day it is, and a course opens before midnight UTC has passed.
    expect(clockRequestBody('in', '2026-08-04')).toEqual({ businessDate: '2026-08-04' })
  })

  it('keeps the break minutes a clock-out has to send', () => {
    expect(clockRequestBody('out', '2026-08-04')).toEqual({
      businessDate: '2026-08-04',
      breakMinutes: 0,
    })
  })

  it('sends the same day for both halves of a punch pair', () => {
    // Clock-out reads the record back by date; disagreeing halves lose the row.
    const day = '2026-08-04'
    expect(clockRequestBody('in', day).businessDate)
      .toBe(clockRequestBody('out', day).businessDate)
  })
})

describe('readableRationale for the auto-assignment plan', () => {
  it('translates the keys the planner now emits', () => {
    // Field used to answer with Japanese sentences compiled into its binary,
    // so an operator reading the app in English got Japanese.
    expect(readableRationale(['on_duty', 'contract_remaining=12', 'second_round_today'])).toEqual([
      '出勤ずみ',
      '月間契約の残り12R',
      '本日2ラウンド目',
    ])
  })

  it('says plainly when a round could not be filled', () => {
    expect(readableRationale(['no_caddie_available'])).toEqual(['配置できるキャディがいません'])
  })
})
