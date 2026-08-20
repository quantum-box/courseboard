export type ReservationReportDayPart = 'morning' | 'afternoon'

export type ReservationReportFacility = {
  sourceCourseKey: string
  sourceCourseName: string
}

export type ReservationReportRow = {
  sourceCourseKey: string
  sourceCourseName: string
  date: string
  dayPart: ReservationReportDayPart
  groupCount: number
  caddieAttachedGroupCount: number
}

export type ReservationReportTotals = {
  facilityCount: number
  rowCount: number
  groupCount: number
  caddieAttachedGroupCount: number
}

export type ReservationReportPreview = {
  sourceSystem: string
  sourceFileSha256: string
  normalizedFingerprint: string
  facilities: ReservationReportFacility[]
  rows: ReservationReportRow[]
  totals: ReservationReportTotals
  /** Half-days the report contradicts itself on. All of them still import. */
  review?: ReservationReportReviewRow[]
  analysis?: ReservationReportAnalysis
}

/**
 * One row worth comparing against the original report.
 *
 * `caddieExceedsGroups` means more caddie-attached groups than groups, which
 * cannot both be right — caddie-attached groups are part of the total, not
 * extra to it. The counts are carried through as the report wrote them, so the
 * desk can see which of the two numbers looks wrong.
 */
export type ReservationReportReviewRow = {
  kind: string
  sourceCourseName: string
  date: string
  dayPart: ReservationReportDayPart
  groupCount: number
  caddieAttachedGroupCount: number
}

export type ReservationReportAnalysis = {
  sourceType: string
  sheetNames: string[]
  selectedSheet?: string | null
  headerRow?: number | null
  headers: string[]
  mapping: ReservationReportMapping
  warnings: string[]
}

export type ReservationReportMapping = {
  mode: 'alias' | 'ai' | string
  fields: ReservationReportMappingField[]
  notes?: string | null
}

export type ReservationReportMappingField = {
  source: string
  target: string
  required: boolean
  confidence: number
  explanation: string
  samples: string[]
}

export const RESERVATION_REPORT_TARGETS = [
  'facilityName',
  'date',
  'dayPart',
  'groupCount',
  'caddieAttachedGroupCount',
] as const

export type ReservationReportTarget = typeof RESERVATION_REPORT_TARGETS[number]
export type ReservationReportColumnMappings = Partial<Record<ReservationReportTarget, string>>

export type ReservationReportImportResult = {
  createdCount: number
  updatedCount: number
  unchangedCount: number
  totals: ReservationReportTotals
  items?: ReservationReportEntry[]
}

export type ReservationReportEntry = ReservationReportRow & {
  id: string
  /** Null means the source facility is intentionally stored without a course link. */
  golfCourseId: string | null
  sourceFileSha256: string
  updatedAt: string
}

export type ReservationReportCourse = {
  id: string
  name: string
  shortName?: string | null
  isActive?: boolean
}

export type ReservationReportCourseMapping = {
  sourceCourseKey: string
  golfCourseId: string
}

export type ReservationReportMonthRow = {
  key: string
  date: string
  sourceCourseKey: string
  sourceCourseName: string
  morningGroupCount: number
  morningCaddieAttachedGroupCount: number
  afternoonGroupCount: number
  afternoonCaddieAttachedGroupCount: number
}

export type MappingValidation =
  | { valid: true }
  | { valid: false; reason: 'duplicate' }

export type ColumnMappingValidation =
  | { valid: true }
  | { valid: false; reason: 'missing' | 'duplicate' | 'unknown' }

export const MAX_FILE_BYTES = 5 * 1024 * 1024

export function columnMappingsFromAnalysis(
  analysis: ReservationReportAnalysis | undefined,
): ReservationReportColumnMappings {
  if (!analysis) return {}
  return Object.fromEntries(
    analysis.mapping.fields
      .filter(field => RESERVATION_REPORT_TARGETS.includes(field.target as ReservationReportTarget))
      .map(field => [field.target, field.source]),
  )
}

export function validateColumnMappings(
  headers: string[],
  mappings: ReservationReportColumnMappings,
): ColumnMappingValidation {
  const selected = RESERVATION_REPORT_TARGETS.map(target => mappings[target]?.trim() ?? '')
  if (selected.some(source => !source)) return { valid: false, reason: 'missing' }
  if (new Set(selected).size !== selected.length) return { valid: false, reason: 'duplicate' }
  const headerCounts = new Map<string, number>()
  for (const header of headers) {
    const normalized = header.trim()
    headerCounts.set(normalized, (headerCounts.get(normalized) ?? 0) + 1)
  }
  if (selected.some(source => headerCounts.get(source) !== 1)) {
    return { valid: false, reason: 'unknown' }
  }
  return { valid: true }
}

function courseNameVariants(value: string) {
  const compact = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s　]+/g, '')
  const withoutHoles = compact.replace(/(?:\d+|\d+ホール|\d+h)$/i, '')
  const withoutCourseSuffix = withoutHoles.replace(/(?:コース|course)$/i, '')
  return new Set([compact, withoutHoles, withoutCourseSuffix].filter(Boolean))
}

export function fileValidationError(file: File | null): 'required' | 'size' | 'extension' | null {
  if (!file) return 'required'
  if (file.size > MAX_FILE_BYTES) return 'size'
  const name = file.name.toLowerCase()
  if (!/\.(?:csv|xls|xlsx|pdf)$/.test(name)) return 'extension'
  return null
}

/**
 * Suggest a course only when the report name is unambiguous. Exact names are
 * preferred; short names are accepted when they point to one active course.
 */
export function suggestCourseMappings(
  facilities: ReservationReportFacility[],
  courses: ReservationReportCourse[],
): Record<string, string> {
  const mappings: Record<string, string> = {}
  for (const facility of facilities) {
    const names = new Set([
      ...courseNameVariants(facility.sourceCourseKey),
      ...courseNameVariants(facility.sourceCourseName),
    ])
    const candidates = courses.filter(course => {
      if (course.isActive === false) return false
      return [...courseNameVariants(course.name), ...courseNameVariants(course.shortName ?? '')]
        .some(candidate => names.has(candidate))
    })
    if (candidates.length === 1) mappings[facility.sourceCourseKey] = candidates[0]!.id
  }
  return mappings
}

export function validateCourseMappings(
  facilities: ReservationReportFacility[],
  mappings: Record<string, string>,
): MappingValidation {
  const selected = new Set<string>()
  for (const facility of facilities) {
    const courseId = mappings[facility.sourceCourseKey]?.trim()
    // An empty selection is meaningful: the facility-level aggregate is kept
    // without guessing at a CourseBoard course.
    if (!courseId) continue
    if (selected.has(courseId)) return { valid: false, reason: 'duplicate' }
    selected.add(courseId)
  }
  return { valid: true }
}

export function monthKey(date: string) {
  return date.slice(0, 7)
}

export function monthsInRows(rows: ReservationReportRow[]) {
  return [...new Set(rows.map(row => monthKey(row.date)).filter(Boolean))].sort()
}

/** Convert the AM/PM wire rows into the readable month table used by the UI. */
export function monthGridRows(rows: ReservationReportRow[], month: string): ReservationReportMonthRow[] {
  const grouped = new Map<string, ReservationReportMonthRow>()
  for (const row of rows) {
    if (monthKey(row.date) !== month) continue
    const key = `${row.sourceCourseKey}:${row.date}`
    const current = grouped.get(key) ?? {
      key,
      date: row.date,
      sourceCourseKey: row.sourceCourseKey,
      sourceCourseName: row.sourceCourseName,
      morningGroupCount: 0,
      morningCaddieAttachedGroupCount: 0,
      afternoonGroupCount: 0,
      afternoonCaddieAttachedGroupCount: 0,
    }
    if (row.dayPart === 'morning') {
      current.morningGroupCount = row.groupCount
      current.morningCaddieAttachedGroupCount = row.caddieAttachedGroupCount
    } else {
      current.afternoonGroupCount = row.groupCount
      current.afternoonCaddieAttachedGroupCount = row.caddieAttachedGroupCount
    }
    grouped.set(key, current)
  }
  return [...grouped.values()].sort(
    (left, right) => left.date.localeCompare(right.date)
      || left.sourceCourseName.localeCompare(right.sourceCourseName)
      || left.sourceCourseKey.localeCompare(right.sourceCourseKey),
  )
}

export function sumRows(rows: ReservationReportRow[]): ReservationReportTotals {
  const facilities = new Set(rows.map(row => row.sourceCourseKey))
  return {
    facilityCount: facilities.size,
    rowCount: rows.length,
    groupCount: rows.reduce((sum, row) => sum + row.groupCount, 0),
    caddieAttachedGroupCount: rows.reduce(
      (sum, row) => sum + row.caddieAttachedGroupCount,
      0,
    ),
  }
}

export function formatMonth(month: string, locale: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  if (!year || !monthNumber) return month
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  )
}

export function formatReportDate(date: string, locale: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(parsed)
}
