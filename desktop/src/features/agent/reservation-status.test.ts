import { beforeEach, describe, expect, it, vi } from 'vitest'
import { courseboardApiJson } from '../../api'
import { getReservationStatus, reservationStatusFromLedger } from './reservation-status'
import type { LedgerColumn, TeeLedgerResponse } from '../golf/ledger/models'
vi.mock('../../api', () => ({ courseboardApiJson: vi.fn() }))
const api = vi.mocked(courseboardApiJson)
function column(name: string, groups: number, players: number, selfGroups: number): LedgerColumn {
  return { golfCourseId: name, courseName: name, gridSource: 'inventory', groupCount: groups, playerCount: players, selfGroupCount: selfGroups, caddieGroupCount: groups - selfGroups, openSlotCount: 10, slots: [] }
}
const ledger: TeeLedgerResponse = { date: '2026-11-07', timezone: 'Asia/Tokyo', columns: [column('A', 13, 45, 9), column('B', 11, 38, 8), column('C', 4, 13, 2), column('D', 1, 2, 1)] }
beforeEach(() => { api.mockReset() })
describe('authoritative reservation status', () => {
  it('reads the reservation ledger, not empty imported reports, and returns its full 29 groups / 98 players', async () => {
    api.mockResolvedValue(ledger)
    const result = await getReservationStatus({}, new AbortController().signal, '2026-11-07')
    expect(api).toHaveBeenCalledWith('/v1/course/tee-ledger?date=2026-11-07', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(result.reservationTotals).toEqual({ groups: 29, players: 98, selfGroups: 20, caddieGroups: 9 })
    expect(result.source).toBe('/v1/course/tee-ledger')
    expect(result.complete).toBe(true)
    expect(JSON.stringify(result)).not.toContain('slots')
  })
  it('preserves all nine reference courses and their IN/OUT figures exactly', () => {
    const expected = [
      ['空沼IN', 13, 45, 9, 4], ['藻岩OUT', 11, 38, 8, 3],
      ['滝のOUT', 4, 13, 2, 2], ['空沼OUT', 1, 2, 1, 0],
      ['藻岩IN', 0, 0, 0, 0], ['滝のIN', 0, 0, 0, 0],
      ['実務再テストコース_20260812', 0, 0, 0, 0],
      ['羊ヶ丘IN', 0, 0, 0, 0], ['羊ケ丘OUT', 0, 0, 0, 0],
    ] as const
    const result = reservationStatusFromLedger({ ...ledger, columns: expected.map(([name, groups, players, self]) => column(name, groups, players, self)) }, ledger.date)
    expect(result.courses.map(course => [course.courseName, course.groups, course.players, course.selfGroups, course.caddieGroups])).toEqual(expected)
    expect(result.reservationTotals).toEqual({ groups: 29, players: 98, selfGroups: 20, caddieGroups: 9 })
  })
  it('returns a confirmed zero only from a successfully loaded nonempty ledger', () => {
    expect(reservationStatusFromLedger({ ...ledger, columns: [column('A', 0, 0, 0)] }, ledger.date).reservationTotals?.groups).toBe(0)
    expect(reservationStatusFromLedger({ ...ledger, columns: [] }, ledger.date).reservationTotals).toBeNull()
  })
  it('does not manufacture zero from a failed, missing, or wrong-day read', async () => {
    api.mockRejectedValue(new Error('forbidden'))
    await expect(getReservationStatus({}, new AbortController().signal, ledger.date)).rejects.toThrow()
    expect(() => reservationStatusFromLedger({ ...ledger, columns: undefined } as unknown as TeeLedgerResponse, ledger.date)).toThrow()
    expect(() => reservationStatusFromLedger(ledger, '2026-11-08')).toThrow()
    expect(() => reservationStatusFromLedger({ ...ledger, columns: [column('A', NaN, 1, 1)] }, ledger.date)).toThrow()
  })
  it('marks partial reads and unknown remaining capacity explicitly', () => {
    const partial = reservationStatusFromLedger({ ...ledger, unavailable: ['resources'] }, ledger.date)
    expect(partial.complete).toBe(false)
    expect(partial.reservationTotals).toBeNull()
    expect(partial.observedTotals.groups).toBe(29)
    const unknownCapacity = reservationStatusFromLedger({ ...ledger, columns: [{ ...ledger.columns[0], gridSource: 'schedule' }] }, ledger.date)
    expect(unknownCapacity.reservationTotals?.groups).toBe(13)
    expect(unknownCapacity.remainingCapacity).toMatchObject({ complete: false, uncountedCourses: 1 })
  })
  it('preserves explicit day and course scope and rejects invalid dates', async () => {
    api.mockResolvedValue(ledger)
    await getReservationStatus({ date: ledger.date, golfCourseIds: ['A', 'B'] }, new AbortController().signal, '2026-11-08')
    expect(api.mock.calls[0][0]).toBe('/v1/course/tee-ledger?date=2026-11-07&golfCourseIds=A%2CB')
    await expect(getReservationStatus({ date: '2026-02-31' }, new AbortController().signal, ledger.date)).rejects.toThrow()
    expect(api).toHaveBeenCalledTimes(1)
  })
})
