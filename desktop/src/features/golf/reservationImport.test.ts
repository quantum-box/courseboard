import { describe, expect, it } from 'vitest'
import {
  courseChoiceOf,
  dailyRows,
  formatMonthDay,
  formatYearMonth,
  hasSomethingToApply,
  IGNORE_COURSE,
  importTotals,
  monthBounds,
  warningCopy,
  type ImportedCourse,
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
  function course(
    sheetLabel: string,
    resolution: ImportedCourse['resolution'],
    totalGroups: number,
    caddieGroups: number,
  ): ImportedCourse {
    return {
      sheetLabel,
      resolution,
      golfCourseId: resolution === 'unresolved' ? undefined : `course-${sheetLabel}`,
      imported: resolution === 'linked' || resolution === 'suggested',
      dayCount: 62,
      totalGroups,
      caddieGroups,
    }
  }

  const courses = [
    course('真駒内', 'suggested', 1800, 700),
    course('滝の', 'linked', 1500, 600),
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

  it('counts only what is going in, not everything the file holds', () => {
    // A club that imports one of the three courses in the file checks this
    // figure against its booking system. Counting the courses it left out
    // would mean the number never matches what landed on the board.
    const mixed = [
      ...courses,
      course('羊ケ丘', 'ignored', 900, 300),
      course('テスト', 'unresolved', 40, 10),
    ]
    expect(importTotals(mixed)).toMatchObject({
      courseCount: 2,
      totalGroups: 3300,
      caddieGroups: 1300,
    })
  })

  it('survives a file where nothing has been answered yet', () => {
    expect(importTotals([course('謎', 'unresolved', 40, 10)])).toMatchObject({
      courseCount: 0,
      dayCount: 0,
      totalGroups: 0,
    })
  })
})

describe('hasSomethingToApply', () => {
  function course(resolution: ImportedCourse['resolution']): ImportedCourse {
    return {
      sheetLabel: '真駒内',
      resolution,
      golfCourseId: resolution === 'unresolved' ? undefined : 'course-a',
      imported: resolution === 'linked' || resolution === 'suggested',
      dayCount: 62,
      totalGroups: 0,
      caddieGroups: 0,
    }
  }

  it('lets a file through when it has a course to import', () => {
    expect(hasSomethingToApply([course('linked')])).toBe(true)
    expect(hasSomethingToApply([course('suggested')])).toBe(true)
  })

  it('lets a file through whose only course is being dropped', () => {
    // A club that stops importing its one course still needs the month it
    // already imported taken off the board, and applying the file is the only
    // thing that does that — saving the choice alone touches nothing.
    expect(hasSomethingToApply([course('ignored')])).toBe(true)
  })

  it('holds back a file nobody has answered for', () => {
    expect(hasSomethingToApply([course('unresolved'), course('ambiguous')])).toBe(false)
    expect(hasSomethingToApply([])).toBe(false)
  })
})

describe('courseChoiceOf', () => {
  function course(resolution: ImportedCourse['resolution'], golfCourseId?: string): ImportedCourse {
    return {
      sheetLabel: '真駒内',
      resolution,
      golfCourseId,
      imported: resolution === 'linked' || resolution === 'suggested',
      dayCount: 62,
      totalGroups: 0,
      caddieGroups: 0,
    }
  }

  it('starts on the course a name already resolves to', () => {
    expect(courseChoiceOf(course('linked', 'course-a'))).toBe('course-a')
    expect(courseChoiceOf(course('suggested', 'course-a'))).toBe('course-a')
  })

  it('shows a deliberate omission as one, not as an unanswered question', () => {
    expect(courseChoiceOf(course('ignored'))).toBe(IGNORE_COURSE)
  })

  it('starts an unanswered name empty so it reads as a question', () => {
    expect(courseChoiceOf(course('unresolved'))).toBe('')
    expect(courseChoiceOf(course('ambiguous'))).toBe('')
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
