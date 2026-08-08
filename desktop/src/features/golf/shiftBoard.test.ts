import { describe, expect, it } from 'vitest'
import { buildShiftRow, jstDateOf, monthDates, STREAK_WARNING_DAYS } from './shiftBoard'

const CADDIE = 'caddie_a'

function assignment(date: string, status = 'assigned') {
  return { caddieProfileId: CADDIE, scheduledAt: `${date}T07:00:00+09:00`, status }
}

describe('monthDates', () => {
  it('lists every day of the month', () => {
    expect(monthDates('2026-07')).toHaveLength(31)
    expect(monthDates('2026-02')).toHaveLength(28)
    expect(monthDates('2028-02')).toHaveLength(29)
    expect(monthDates('2026-07')[0]).toBe('2026-07-01')
    expect(monthDates('2026-2')).toEqual(monthDates('2026-02'))
    expect(monthDates('２０２６-２')).toEqual(monthDates('2026-02'))
    expect(monthDates('nonsense')).toEqual([])
    expect(monthDates('')).toEqual([])
    expect(monthDates('2026-00')).toEqual([])
    expect(monthDates('2026-13')).toEqual([])
  })
})

describe('buildShiftRow', () => {
  const dates = monthDates('2026-07')

  it('prefers assignments over availability and counts them', () => {
    const row = buildShiftRow(
      CADDIE,
      dates,
      [{ caddieProfileId: CADDIE, date: '2026-07-01', status: 'unavailable' }],
      [assignment('2026-07-01'), assignment('2026-07-01')],
    )
    expect(row.cells[0]).toMatchObject({ kind: 'assigned', assignments: 2 })
  })

  it('maps availability statuses and ignores other caddies', () => {
    const row = buildShiftRow(
      CADDIE,
      dates,
      [
        { caddieProfileId: CADDIE, date: '2026-07-02', status: 'unavailable' },
        { caddieProfileId: CADDIE, date: '2026-07-03', status: 'morning_only' },
        { caddieProfileId: 'someone_else', date: '2026-07-04', status: 'unavailable' },
      ],
      [{ caddieProfileId: 'someone_else', scheduledAt: '2026-07-05T07:00:00+09:00', status: 'assigned' }],
    )
    expect(row.cells[1]!.kind).toBe('off')
    expect(row.cells[2]!.kind).toBe('morning')
    expect(row.cells[3]!.kind).toBe('none')
    expect(row.cells[4]!.kind).toBe('none')
  })

  it('does not count cancelled assignments as working days', () => {
    const row = buildShiftRow(CADDIE, dates, [], [assignment('2026-07-01', 'cancelled')])
    expect(row.cells[0]!.kind).toBe('none')
    expect(row.maxStreak).toBe(0)
  })

  it('flags runs at the warning threshold and reports the longest streak', () => {
    const streak = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']
    expect(streak).toHaveLength(STREAK_WARNING_DAYS)
    const row = buildShiftRow(CADDIE, dates, [], [
      ...streak.map(date => assignment(date)),
      assignment('2026-07-14'),
    ])
    expect(row.maxStreak).toBe(6)
    // The six-day run is highlighted; the isolated day is not.
    expect(row.cells[5]!.inLongStreak).toBe(true)
    expect(row.cells[10]!.inLongStreak).toBe(true)
    expect(row.cells[13]!.inLongStreak).toBe(false)
  })

  it('files UTC timestamps under their JST calendar date', () => {
    // 07:00 JST on July 1st arrives from the API as 22:00Z on June 30th.
    expect(jstDateOf('2026-06-30T22:00:00Z')).toBe('2026-07-01')
    expect(jstDateOf('2026-07-01T07:00:00+09:00')).toBe('2026-07-01')
    const row = buildShiftRow(CADDIE, dates, [], [
      { caddieProfileId: CADDIE, scheduledAt: '2026-06-30T22:00:00Z', status: 'assigned' },
    ])
    expect(row.cells[0]).toMatchObject({ date: '2026-07-01', kind: 'assigned' })
  })

  it('detects streaks that cross the month boundary', () => {
    // Jun 28–30 + Jul 1–3 is a six-day run even though only July is displayed.
    const row = buildShiftRow(CADDIE, dates, [], [
      ...['2026-06-28', '2026-06-29', '2026-06-30'].map(date => assignment(date)),
      ...['2026-07-01', '2026-07-02', '2026-07-03'].map(date => assignment(date)),
    ])
    expect(row.maxStreak).toBe(6)
    expect(row.cells[0]!.inLongStreak).toBe(true)
    expect(row.cells[2]!.inLongStreak).toBe(true)
    expect(row.cells[3]!.inLongStreak).toBe(false)
    // Only July's days are rendered.
    expect(row.cells[0]!.date).toBe('2026-07-01')
  })

  it('leaves short runs unhighlighted', () => {
    const row = buildShiftRow(CADDIE, dates, [], [
      assignment('2026-07-01'),
      assignment('2026-07-02'),
    ])
    expect(row.maxStreak).toBe(2)
    expect(row.cells.every(cell => !cell.inLongStreak)).toBe(true)
  })
})
