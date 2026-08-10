import { describe, expect, it } from 'vitest'
import { ja } from '../../i18n/locales/ja'
import { jaPlain } from '../../i18n/locales/ja-plain'
import {
  buildShiftRow,
  jstDateOf,
  monthDates,
  STREAK_WARNING_DAYS,
  type ConfirmedShift,
} from './shiftBoard'

const CADDIE = 'caddie_a'
const PROFILE = { id: CADDIE, employmentStatus: 'active' }

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
      PROFILE,
      dates,
      [{ caddieProfileId: CADDIE, date: '2026-07-01', status: 'unavailable' }],
      [assignment('2026-07-01'), assignment('2026-07-01')],
    )
    expect(row.cells[0]).toMatchObject({ kind: 'assigned', assignments: 2 })
  })

  it('preserves every availability status and ignores other caddies', () => {
    const row = buildShiftRow(
      PROFILE,
      dates,
      [
        { caddieProfileId: CADDIE, date: '2026-07-01', status: 'available' },
        { caddieProfileId: CADDIE, date: '2026-07-02', status: 'unavailable' },
        { caddieProfileId: CADDIE, date: '2026-07-03', status: 'morning_only' },
        { caddieProfileId: CADDIE, date: '2026-07-04', status: 'afternoon_only' },
        { caddieProfileId: CADDIE, date: '2026-07-05', status: 'light_duty' },
        { caddieProfileId: 'someone_else', date: '2026-07-04', status: 'unavailable' },
      ],
      [{ caddieProfileId: 'someone_else', scheduledAt: '2026-07-06T07:00:00+09:00', status: 'assigned' }],
    )
    expect(row.cells[0]!.kind).toBe('available')
    expect(row.cells[1]!.kind).toBe('off')
    expect(row.cells[2]!.kind).toBe('morning')
    expect(row.cells[3]!.kind).toBe('afternoon')
    expect(row.cells[4]!.kind).toBe('light')
    expect(row.cells[5]!.kind).toBe('none')
  })

  it('does not count cancelled assignments as working days', () => {
    const row = buildShiftRow(PROFILE, dates, [], [assignment('2026-07-01', 'cancelled')])
    expect(row.cells[0]!.kind).toBe('none')
    expect(row.maxStreak).toBe(0)
  })

  it('does not silently turn a new availability status into an empty cell', () => {
    const row = buildShiftRow(PROFILE, dates, [
      { caddieProfileId: CADDIE, date: '2026-07-01', status: 'new_field_status' },
    ], [])
    expect(row.cells[0]).toMatchObject({ kind: 'unknown', inLongStreak: false })
  })

  it('flags runs at the warning threshold and reports the longest streak', () => {
    const streak = [
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]
    expect(streak).toHaveLength(STREAK_WARNING_DAYS)
    const row = buildShiftRow(PROFILE, dates, [], [
      ...streak.map(date => assignment(date)),
      assignment('2026-07-14'),
    ])
    expect(row.maxStreak).toBe(7)
    // The seven-day run is highlighted; the isolated day is not.
    expect(row.cells[5]!.inLongStreak).toBe(true)
    expect(row.cells[10]!.inLongStreak).toBe(true)
    expect(row.cells[13]!.inLongStreak).toBe(false)
  })

  it('files UTC timestamps under their JST calendar date', () => {
    // 07:00 JST on July 1st arrives from the API as 22:00Z on June 30th.
    expect(jstDateOf('2026-06-30T22:00:00Z')).toBe('2026-07-01')
    expect(jstDateOf('2026-07-01T07:00:00+09:00')).toBe('2026-07-01')
    const row = buildShiftRow(PROFILE, dates, [], [
      { caddieProfileId: CADDIE, scheduledAt: '2026-06-30T22:00:00Z', status: 'assigned' },
    ])
    expect(row.cells[0]).toMatchObject({ date: '2026-07-01', kind: 'assigned' })
  })

  it('detects streaks that cross the month boundary', () => {
    // Jun 27–30 + Jul 1–3 is a seven-day run even though only July is shown.
    const row = buildShiftRow(PROFILE, dates, [], [
      ...['2026-06-27', '2026-06-28', '2026-06-29', '2026-06-30'].map(date => assignment(date)),
      ...['2026-07-01', '2026-07-02', '2026-07-03'].map(date => assignment(date)),
    ])
    expect(row.maxStreak).toBe(7)
    expect(row.cells[0]!.inLongStreak).toBe(true)
    expect(row.cells[2]!.inLongStreak).toBe(true)
    expect(row.cells[3]!.inLongStreak).toBe(false)
    // Only July's days are rendered.
    expect(row.cells[0]!.date).toBe('2026-07-01')
  })

  it('leaves short runs unhighlighted', () => {
    const row = buildShiftRow(PROFILE, dates, [], [
      assignment('2026-07-01'),
      assignment('2026-07-02'),
    ])
    expect(row.maxStreak).toBe(2)
    expect(row.cells.every(cell => !cell.inLongStreak)).toBe(true)
  })

  it('keeps inactive and suspended profiles on the board with their status', () => {
    expect(buildShiftRow({ id: CADDIE, employmentStatus: 'inactive' }, dates, [], []))
      .toMatchObject({ caddieProfileId: CADDIE, employmentStatus: 'inactive' })
    expect(buildShiftRow({ id: CADDIE, employmentStatus: 'Suspended' }, dates, [], []))
      .toMatchObject({ caddieProfileId: CADDIE, employmentStatus: 'suspended' })
  })

  it('counts explicit workable availability in consecutive-work warnings', () => {
    const workingDates = [
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]
    const row = buildShiftRow(PROFILE, dates, workingDates.map((date, index) => ({
      caddieProfileId: CADDIE,
      date,
      status: index === 3 ? 'morning_only' : 'available',
    })), [])

    expect(row.maxStreak).toBe(STREAK_WARNING_DAYS)
    expect(row.cells[0]!.inLongStreak).toBe(true)
    expect(row.cells[4]!.inLongStreak).toBe(true)
  })
})

describe('confirmed shifts on the board', () => {
  const dates = monthDates('2026-07')

  function confirmed(date: string, overrides: Partial<ConfirmedShift> = {}): ConfirmedShift {
    return {
      caddieProfileId: CADDIE,
      date,
      golfCourseId: 'out',
      isWorking: true,
      span: 'full_day',
      roundsCapacity: 1,
      origin: 'generated',
      note: null,
      ...overrides,
    }
  }

  it('shows what the desk confirmed rather than what was asked for', () => {
    const row = buildShiftRow(
      PROFILE,
      dates,
      [{ caddieProfileId: CADDIE, date: '2026-07-01', status: 'unavailable' }],
      [],
      [confirmed('2026-07-01', { note: '本人了承済み', origin: 'edited' })],
    )

    expect(row.cells[0]!.kind).toBe('available')
    expect(row.cells[0]!.confirmed).toMatchObject({ golfCourseId: 'out', origin: 'edited' })
  })

  it('reads a half-day and a day off from the confirmed span', () => {
    const row = buildShiftRow(PROFILE, dates, [], [], [
      confirmed('2026-07-01', { span: 'morning' }),
      confirmed('2026-07-02', { span: 'afternoon' }),
      confirmed('2026-07-03', { isWorking: false, golfCourseId: null, roundsCapacity: 0 }),
    ])

    expect(row.cells[0]!.kind).toBe('morning')
    expect(row.cells[1]!.kind).toBe('afternoon')
    expect(row.cells[2]!.kind).toBe('off')
  })

  it('falls back to the filed request on days the month was not confirmed for', () => {
    const row = buildShiftRow(
      PROFILE,
      dates,
      [{ caddieProfileId: CADDIE, date: '2026-07-02', status: 'unavailable' }],
      [],
      [confirmed('2026-07-01')],
    )

    expect(row.cells[1]!.kind).toBe('off')
    expect(row.cells[1]!.confirmed).toBeNull()
  })

  it('counts confirmed working days in consecutive-work warnings', () => {
    const row = buildShiftRow(PROFILE, dates, [], [], [
      confirmed('2026-06-29'),
      confirmed('2026-06-30'),
      confirmed('2026-07-01'),
      confirmed('2026-07-02'),
      confirmed('2026-07-03'),
      confirmed('2026-07-04'),
      confirmed('2026-07-05'),
    ])

    expect(row.maxStreak).toBe(STREAK_WARNING_DAYS)
    expect(row.cells[0]!.inLongStreak).toBe(true)
  })

  it('ignores another caddie’s confirmed day', () => {
    const row = buildShiftRow(PROFILE, dates, [], [], [
      confirmed('2026-07-01', { caddieProfileId: 'someone_else' }),
    ])

    expect(row.cells[0]!.kind).toBe('none')
    expect(row.cells[0]!.confirmed).toBeNull()
  })
})

describe('unsaved availability copy', () => {
  it('defines the visible labels for the states that used to disappear', () => {
    expect(ja.shifts.cell.available).toBe('可')
    expect(ja.shifts.employment.inactive).toBe('休んでいる')
    expect(ja.shifts.employment.suspended).toBe('止めている')
  })

  it('explains that unsaved changes will be lost without using a literal Discard translation', () => {
    expect(ja.caddies.calendar.confirmDiscard).toContain('失われます')
    expect(ja.caddies.calendar.confirmDiscard).not.toContain('捨てて')
    expect(jaPlain.caddies.calendar?.confirmDiscard).toContain('消えます')
  })
})
