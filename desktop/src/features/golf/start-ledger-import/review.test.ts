import { describe, expect, it } from 'vitest'
import type { StartLedgerContext, StartLedgerPartyDraft, StartLedgerRead } from './api'
import { blocking, buildReview, chunks, competitionFrom, matchCourse, matchPlan, isDone, partiesToImport, pendingParties, reviewIssues, toImportParty } from './review'

const context: StartLedgerContext = {
  courses: [{ id: 'out', name: '空沼 OUT' }, { id: 'in', name: '空沼IN' }],
  plans: [
    { reservationServiceId: 'early133', name: '早期予約133', requiresCaddie: true },
    { reservationServiceId: 'early19', name: '早期予約19（全20回）', requiresCaddie: false, courseIds: ['in'] },
  ],
  booked: [{ golfCourseId: 'in', teeTime: '09:20', reservationId: 'r-1', customerName: '大石 佳範' }],
}

function draft(overrides: Partial<StartLedgerPartyDraft>): StartLedgerPartyDraft {
  return { players: [], remarks: {}, copiedFromAbove: [], warnings: [], ...overrides }
}

const read: StartLedgerRead = {
  id: 'job', status: 'completed', completedUnits: 3, totalUnits: 3, date: '2026-11-07', warnings: [],
  parties: [
    draft({ courseName: '空沼OUT', teeTime: '08:45', playStyle: 'caddie', playStyleText: 'キャディ', representative: '菊池 芳彦', groupName: '菊池 芳彦 様', planName: '早期予約133', players: [{ tag: '共通', number: '1', name: '丹治 敦' }, { tag: '共通', number: '1', name: '髙橋 康彦' }] }),
    draft({ courseName: '空沼IN', teeTime: '08:45', playStyle: 'caddie', playStyleText: 'キャディ', representative: '加藤 美之', groupName: '１・３会', planName: '早期予約19（全20回）', remarks: { meal: '各自注文', scoreTally: true, settlement: 'individual' }, notes: '2B@2750' }),
    draft({ courseName: '空沼IN', teeTime: '09:20', playStyle: 'self', representative: '大石 佳範' }),
  ],
}

describe('matching printed names', () => {
  it('ignores width and spacing, and refuses an ambiguous partial match', () => {
    expect(matchCourse('空沼OUT', context.courses)).toBe('out')
    expect(matchCourse('ｿﾗﾇﾏ', context.courses)).toBe('')
    expect(matchCourse('空沼', context.courses)).toBe('')
  })

  it('only offers plans sold on the course', () => {
    expect(matchPlan('早期予約19（全20回）', context.plans, 'in')).toBe('early19')
    expect(matchPlan('早期予約19（全20回）', context.plans, 'out')).toBe('')
  })

  it('treats 「〜 様」 as the booker rather than a competition', () => {
    expect(competitionFrom('菊池 芳彦 様')).toBe('')
    expect(competitionFrom('１・３会')).toBe('１・３会')
  })
})

describe('review', () => {
  const parties = buildReview(read, context)

  it('suggests course, plan, players, and remarks from the read', () => {
    expect(parties[0]).toMatchObject({ courseId: 'out', planId: 'early133', customerName: '菊池 芳彦', competitionName: '', checked: false })
    expect(parties[0]!.players).toHaveLength(4)
    expect(parties[1]).toMatchObject({ courseId: 'in', planId: 'early19', competitionName: '１・３会', notes: '2B@2750' })
    expect(parties[1]!.remarks).toEqual({ meal: '各自注文', scoreTally: 'yes', settlement: 'individual', note: '' })
  })

  it('warns when the sheet says caddie and the plan is self-play', () => {
    expect(reviewIssues(parties[0]!, parties, context).caddieMismatch).toBe(false)
    expect(reviewIssues(parties[1]!, parties, context).caddieMismatch).toBe(true)
  })

  it('flags a tee time already on the ledger and a repeated row', () => {
    expect(reviewIssues(parties[2]!, parties, context).booked?.reservationId).toBe('r-1')
    const repeated = [...parties, { ...parties[0]!, key: 'copy' }]
    expect(reviewIssues(repeated[0]!, repeated, context).repeated).toBe(true)
  })

  it('blocks a group with no course, time, or name', () => {
    const missing = { ...parties[0]!, courseId: '', teeTime: '8時', customerName: ' ' }
    const issues = reviewIssues(missing, parties, context)
    expect(issues).toMatchObject({ course: true, teeTime: true, name: true })
    expect(blocking(issues)).toBe(true)
  })

  it('imports only checked groups and keeps the rest pending', () => {
    const checked = parties.map((party, index) => index === 0 ? { ...party, checked: true } : index === 2 ? { ...party, excluded: true } : party)
    expect(partiesToImport(checked).map(party => party.key)).toEqual(['0'])
    expect(pendingParties(checked, context).map(party => party.key)).toEqual(['1'])
    const done = checked.map(party => party.key === '0' ? { ...party, result: { outcome: 'created' as const, reservationId: 'r-9' } } : party)
    expect(partiesToImport(done)).toEqual([])
  })

  it('keeps a failed group pending and sendable again', () => {
    const failed = parties.map(party => party.key === '0' ? { ...party, checked: true, result: { outcome: 'failed' as const, message: 'bad time' } } : party)
    expect(isDone(failed[0]!)).toBe(false)
    expect(partiesToImport(failed).map(party => party.key)).toEqual(['0'])
    expect(pendingParties(failed, context).map(party => party.key)).toContain('1')
  })

  it('sends named players, the headcount, remarks, and notes', () => {
    expect(toImportParty(parties[1]!)).toEqual({
      golfCourseId: 'in', teeTime: '08:45', reservationServiceId: 'early19', customerName: '加藤 美之', quantity: 1,
      competitionName: '１・３会', players: [], remarks: { meal: '各自注文', scoreTally: true, settlement: 'individual' }, notes: '2B@2750',
    })
    expect(toImportParty(parties[0]!)).toMatchObject({ quantity: 2, players: [{ name: '丹治 敦', tag: '共通', memberNumber: '1' }, { name: '髙橋 康彦', tag: '共通', memberNumber: '1' }], competitionName: null, notes: null })
  })
})

it('sends a day in pieces the server accepts', () => {
  expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
})
