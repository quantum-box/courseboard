/**
 * Reading the club's daily reservation export.
 *
 * The booking system exports a count per course per half-day and nothing finer
 * — no start times, no per-booking caddie flag — so everything on this screen
 * is built from that grain. The file itself is read on the server; what lives
 * here is how the result is shown and, above all, how a problem with it is
 * worded.
 */

export type TimeOfDay = 'am' | 'pm'

export type ReservationSummary = {
  golfCourseId: string
  date: string
  timeOfDay: TimeOfDay
  totalGroups: number
  caddieGroups: number
  selfPlayGroups: number
}

export type ImportedCourse = {
  /** The course name as the file writes it. */
  sheetLabel: string
  golfCourseId: string
  courseName: string
  dayCount: number
  totalGroups: number
  caddieGroups: number
}

/**
 * The problems the import knows how to describe.
 *
 * Listed rather than left open so a warning always has copy behind it: a kind
 * the server grew and the screen has not learned yet falls back to a plain
 * sentence instead of rendering a translation key at somebody.
 */
export const WARNING_KINDS = [
  'unreadableCount',
  'caddieGroupsExceedTotal',
  'courseTotalsDisagreeWithSheet',
  'unknownCourse',
  'ambiguousCourse',
] as const

export type WarningKind = (typeof WARNING_KINDS)[number]

export type ImportWarning = {
  kind: string
  courseLabel?: string
  date?: string
  timeOfDay?: TimeOfDay
  totalGroups?: number
  caddieGroups?: number
  sheetTotal?: number
  importedTotal?: number
  candidates?: string[]
}

export type ReservationImportResult = {
  yearMonth: string
  imported: number
  skipped: number
  from: string
  to: string
  courses: ImportedCourse[]
  warnings: ImportWarning[]
  summaries: ReservationSummary[]
}

/** One row of the day-by-day table: a date, with its two halves side by side. */
export type DailyRow = {
  date: string
  morningGroups: number
  morningCaddieGroups: number
  afternoonGroups: number
  afternoonCaddieGroups: number
  totalGroups: number
  caddieGroups: number
}

/**
 * Roll the per-course half-day counts up into one row per date.
 *
 * The desk reads this month as a calendar, not as a list of course-halves, so
 * the table is a date per line. Courses stay separable through the filter above
 * it rather than by putting sixty-two lines on the screen.
 */
export function dailyRows(summaries: ReservationSummary[]): DailyRow[] {
  const byDate = new Map<string, DailyRow>()
  for (const summary of summaries) {
    const row = byDate.get(summary.date) ?? {
      date: summary.date,
      morningGroups: 0,
      morningCaddieGroups: 0,
      afternoonGroups: 0,
      afternoonCaddieGroups: 0,
      totalGroups: 0,
      caddieGroups: 0,
    }
    if (summary.timeOfDay === 'am') {
      row.morningGroups += summary.totalGroups
      row.morningCaddieGroups += summary.caddieGroups
    } else {
      row.afternoonGroups += summary.totalGroups
      row.afternoonCaddieGroups += summary.caddieGroups
    }
    row.totalGroups += summary.totalGroups
    row.caddieGroups += summary.caddieGroups
    byDate.set(summary.date, row)
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export type ImportTotals = {
  courseCount: number
  dayCount: number
  totalGroups: number
  caddieGroups: number
}

/** What the whole file adds up to, for the glance that answers "is this the right month". */
export function importTotals(courses: ImportedCourse[]): ImportTotals {
  return {
    courseCount: courses.length,
    // A course contributes two half-days per date, so its day count is halved
    // back into days a person would recognise.
    dayCount: Math.max(...courses.map(course => Math.ceil(course.dayCount / 2)), 0),
    totalGroups: courses.reduce((sum, course) => sum + course.totalGroups, 0),
    caddieGroups: courses.reduce((sum, course) => sum + course.caddieGroups, 0),
  }
}

/**
 * A warning reduced to the pieces a sentence needs.
 *
 * Never a row or cell reference: "7月3日の滝の（午前）の組数が読み取れません" sends
 * somebody to a day they can go and check, and "row 38, column J" sends them
 * nowhere. The wording itself is left to the screen, which knows the reader's
 * language — including what to call the two halves of the day.
 */
export type WarningCopy = {
  kind: WarningKind | 'unknown'
  tone: 'warning' | 'danger'
  /** The date as the desk says it, or empty when the warning is not about one day. */
  date: string
  timeOfDay?: TimeOfDay
  course: string
  totalGroups: number
  caddieGroups: number
  sheetTotal: number
  importedTotal: number
  /** Course names a label could have meant, already joined for reading. */
  candidates: string
}

export function warningCopy(warning: ImportWarning): WarningCopy {
  const kind = (WARNING_KINDS as readonly string[]).includes(warning.kind)
    ? (warning.kind as WarningKind)
    : 'unknown'
  return {
    kind,
    // A course that will not be imported at all loses a third of the month, so
    // it is not the same weight as one day reading oddly.
    tone: kind === 'unknownCourse' || kind === 'ambiguousCourse' ? 'danger' : 'warning',
    date: warning.date ? formatMonthDay(warning.date) : '',
    timeOfDay: warning.timeOfDay,
    course: warning.courseLabel ?? '',
    totalGroups: warning.totalGroups ?? 0,
    caddieGroups: warning.caddieGroups ?? 0,
    sheetTotal: warning.sheetTotal ?? 0,
    importedTotal: warning.importedTotal ?? 0,
    candidates: warning.candidates?.join('、') ?? '',
  }
}

/** `2026-07-03` → `7月3日`, the way the desk says a date out loud. */
export function formatMonthDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return iso
  return `${Number(match[2])}月${Number(match[3])}日`
}

/** `2026-07` → `2026年7月`. */
export function formatYearMonth(yearMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim())
  if (!match) return yearMonth
  return `${match[1]}年${Number(match[2])}月`
}

/** The first and last day of a `YYYY-MM`, for reading a stored month back. */
export function monthBounds(yearMonth: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  // Day 0 of the next month is the last day of this one, which keeps February
  // and the leap years right without a table of month lengths.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  }
}
