import { describe, expect, it } from 'vitest'
import {
  dailyRows,
  formatMonthDay,
  formatYearMonth,
  importTotals,
  monthBounds,
  warningCopy,
  type ReservationSummary,
} from './reservationImport'

function summary(
  golfCourseId: string,
  date: string,
  timeOfDay: 'am' | 'pm',
  totalGroups: number,
  caddieGroups: number,
): ReservationSummary {
  return {
    golfCourseId,
    date,
    timeOfDay,
    totalGroups,
    caddieGroups,
    selfPlayGroups: Math.max(totalGroups - caddieGroups, 0),
  }
}

describe('dailyRows', () => {
  it('puts a date on one line with its two halves side by side', () => {
    const rows = dailyRows([
      summary('a', '2026-07-01', 'am', 70, 21),
      summary('a', '2026-07-01', 'pm', 19, 9),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      morningGroups: 70,
      morningCaddieGroups: 21,
      afternoonGroups: 19,
      afternoonCaddieGroups: 9,
      totalGroups: 89,
      caddieGroups: 30,
    })
  })

  it('adds the club’s courses together on the day they share', () => {
    const rows = dailyRows([
      summary('makomanai', '2026-07-01', 'am', 70, 21),
      summary('takino', '2026-07-01', 'am', 51, 24),
      summary('hitsujigaoka', '2026-07-01', 'am', 26, 11),
    ])
    expect(rows[0].morningGroups).toBe(147)
    expect(rows[0].morningCaddieGroups).toBe(56)
  })

  it('reads in date order however the file arrived', () => {
    const rows = dailyRows([
      summary('a', '2026-07-31', 'am', 1, 0),
      summary('a', '2026-07-01', 'am', 2, 0),
      summary('a', '2026-07-15', 'am', 3, 0),
    ])
    expect(rows.map(row => row.date)).toEqual(['2026-07-01', '2026-07-15', '2026-07-31'])
  })

  it('keeps a closed day on the board as a zero', () => {
    // 真駒内 shuts on six July days. Dropping the row would leave the reader
    // thinking the export was short rather than the course closed.
    const rows = dailyRows([
      summary('makomanai', '2026-07-06', 'am', 0, 0),
      summary('makomanai', '2026-07-06', 'pm', 0, 0),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].totalGroups).toBe(0)
  })
})

describe('importTotals', () => {
  const courses = [
    { sheetLabel: '真駒内', golfCourseId: 'a', courseName: '真駒内', dayCount: 62, totalGroups: 1800, caddieGroups: 700 },
    { sheetLabel: '滝の', golfCourseId: 'b', courseName: '滝の', dayCount: 62, totalGroups: 1500, caddieGroups: 600 },
  ]

  it('counts days the way a calendar does, not half-days', () => {
    // 62 half-days is a 31-day month, and telling the desk "62 days" would
    // read as a two-month file.
    expect(importTotals(courses).dayCount).toBe(31)
  })

  it('adds the courses up so the month can be recognised at a glance', () => {
    expect(importTotals(courses)).toMatchObject({
      courseCount: 2,
      totalGroups: 3300,
      caddieGroups: 1300,
    })
  })

  it('survives a file that matched no course at all', () => {
    expect(importTotals([])).toMatchObject({ courseCount: 0, dayCount: 0, totalGroups: 0 })
  })
})

describe('warningCopy', () => {
  it('names the day and course rather than a place in the spreadsheet', () => {
    const copy = warningCopy({
      kind: 'unreadableCount',
      courseLabel: '滝の',
      date: '2026-07-03',
      timeOfDay: 'am',
    })
    expect(copy.kind).toBe('unreadableCount')
    expect(copy).toMatchObject({ course: '滝の', date: '7月3日', timeOfDay: 'am' })
    expect(copy.tone).toBe('warning')
  })

  it('treats a course that will not be imported as the more serious problem', () => {
    // A whole course missing loses a third of the month; one odd day does not.
    expect(warningCopy({ kind: 'unknownCourse', courseLabel: '羊ケ丘' }).tone).toBe('danger')
    expect(warningCopy({ kind: 'ambiguousCourse', courseLabel: '東', candidates: ['東コース', '東コース 旧'] }))
      .toMatchObject({ tone: 'danger', candidates: '東コース、東コース 旧' })
  })

  it('carries both sides of a total that does not agree', () => {
    const copy = warningCopy({
      kind: 'courseTotalsDisagreeWithSheet',
      date: '2026-07-03',
      timeOfDay: 'pm',
      sheetTotal: 88,
      importedTotal: 56,
    })
    expect(copy).toMatchObject({ sheetTotal: 88, importedTotal: 56, timeOfDay: 'pm' })
  })
})

describe('formatting', () => {
  it('writes a date the way the desk says it', () => {
    expect(formatMonthDay('2026-07-03')).toBe('7月3日')
    expect(formatMonthDay('2026-12-25')).toBe('12月25日')
  })

  it('leaves something that is not a date alone rather than mangling it', () => {
    expect(formatMonthDay('unknown')).toBe('unknown')
  })

  it('writes a month the same way', () => {
    expect(formatYearMonth('2026-07')).toBe('2026年7月')
  })
})

describe('monthBounds', () => {
  it('covers the whole month, last day included', () => {
    expect(monthBounds('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('gets the short months and the leap years right', () => {
    expect(monthBounds('2026-02')?.to).toBe('2026-02-28')
    expect(monthBounds('2028-02')?.to).toBe('2028-02-29')
    expect(monthBounds('2026-11')?.to).toBe('2026-11-30')
  })

  it('refuses a month that is not one', () => {
    expect(monthBounds('2026-13')).toBeNull()
    expect(monthBounds('2026')).toBeNull()
  })
})
