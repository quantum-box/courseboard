/**
 * Pure layout logic for the shift board: one row per caddie, one cell per day,
 * plus consecutive-working-day detection. Kept free of React so it can be
 * tested directly.
 */

import { yearMonthDates } from '../../lib/yearMonth'

export type ShiftAvailability = {
  caddieProfileId: string
  date: string
  status: string
}

export type ShiftProfile = {
  id: string
  employmentStatus: string
}

export type ShiftAssignment = {
  caddieProfileId: string
  scheduledAt: string
  status: string
}

/**
 * One caddie's confirmed day, as the month was planned into. This is what the
 * board draws once a month has been confirmed: the request says who would
 * rather not work, the confirmed shift says who works and on which course.
 */
export type ConfirmedShift = {
  caddieProfileId: string
  date: string
  golfCourseId: string | null
  isWorking: boolean
  span: string
  roundsCapacity: number
  origin: string
  note: string | null
}

export type ShiftCellKind =
  | 'assigned'
  | 'available'
  | 'off'
  | 'morning'
  | 'afternoon'
  | 'light'
  | 'unknown'
  | 'none'

export type ShiftCell = {
  date: string
  kind: ShiftCellKind
  assignments: number
  /** Part of a run of working days at or above the warning threshold. */
  inLongStreak: boolean
  /** The confirmed shift for the day, once the month has been planned. */
  confirmed: ConfirmedShift | null
}

export type ShiftRow = {
  caddieProfileId: string
  employmentStatus: string
  cells: ShiftCell[]
  maxStreak: number
}

/**
 * A run this long has no statutory rest day in it.
 *
 * The Labour Standards Act wants one day off a week, which the monthly plan
 * enforces as at most six working days in a row — so six is the legal ceiling,
 * not a problem, and warning at six would flag every correctly planned month.
 * Seven is the first run that is actually short of a rest day, and can now only
 * arise from a pinned day or a hand edit.
 */
export const STREAK_WARNING_DAYS = 7

const CANCELLED = new Set(['cancelled', 'canceled'])
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Calendar date in Asia/Tokyo. Production timestamps are UTC (`...Z`), so a
 * 07:00 JST round arrives as 22:00Z on the previous date — slicing the string
 * would file it under the wrong day.
 */
export function jstDateOf(isoTimestamp: string): string {
  const ms = Date.parse(isoTimestamp)
  if (Number.isNaN(ms)) return isoTimestamp.slice(0, 10)
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Month range widened by the streak window, for fetching assignments. */
export function paddedRange(dates: string[]): { from: string; to: string } {
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (first === undefined || last === undefined) return { from: '', to: '' }
  return {
    from: shiftDate(first, -STREAK_WARNING_DAYS),
    to: shiftDate(last, STREAK_WARNING_DAYS),
  }
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export function monthDates(yearMonth: string): string[] {
  return yearMonthDates(yearMonth)
}

type AvailabilityProjection = {
  kind: ShiftCellKind
  working: boolean
}

const NO_AVAILABILITY: AvailabilityProjection = { kind: 'none', working: false }
const UNKNOWN_AVAILABILITY: AvailabilityProjection = { kind: 'unknown', working: false }
const AVAILABILITY_PROJECTION: Record<string, AvailabilityProjection> = {
  available: { kind: 'available', working: true },
  unavailable: { kind: 'off', working: false },
  morning_only: { kind: 'morning', working: true },
  afternoon_only: { kind: 'afternoon', working: true },
  light_duty: { kind: 'light', working: true },
}

function availabilityProjection(status: string | undefined): AvailabilityProjection {
  if (status === undefined) return NO_AVAILABILITY
  return AVAILABILITY_PROJECTION[status.trim().toLowerCase()] ?? UNKNOWN_AVAILABILITY
}

/**
 * A confirmed shift outranks the request behind it: the desk may have put
 * somebody to work on a day they filed off, or moved them to another course,
 * and the board has to show what was decided rather than what was asked for.
 */
function confirmedProjection(shift: ConfirmedShift): AvailabilityProjection {
  if (!shift.isWorking) return { kind: 'off', working: false }
  if (shift.span === 'morning') return { kind: 'morning', working: true }
  if (shift.span === 'afternoon') return { kind: 'afternoon', working: true }
  return { kind: 'available', working: true }
}

function dayProjection(
  confirmed: ConfirmedShift | undefined,
  status: string | undefined,
): AvailabilityProjection {
  return confirmed ? confirmedProjection(confirmed) : availabilityProjection(status)
}

function employmentStatus(status: string): string {
  const normalized = status.trim().toLowerCase()
  if (!normalized) return 'active'
  return ['active', 'inactive', 'suspended'].includes(normalized)
    ? normalized
    : status.trim()
}

export function buildShiftRow(
  profile: ShiftProfile,
  dates: string[],
  availabilities: ShiftAvailability[],
  assignments: ShiftAssignment[],
  confirmedShifts: ConfirmedShift[] = [],
): ShiftRow {
  const availabilityByDate = new Map<string, string>()
  for (const entry of availabilities) {
    if (entry.caddieProfileId === profile.id) {
      availabilityByDate.set(entry.date, entry.status)
    }
  }
  const confirmedByDate = new Map<string, ConfirmedShift>()
  for (const shift of confirmedShifts) {
    if (shift.caddieProfileId === profile.id) {
      confirmedByDate.set(shift.date, shift)
    }
  }
  const assignmentCount = new Map<string, number>()
  for (const assignment of assignments) {
    if (assignment.caddieProfileId !== profile.id) continue
    if (CANCELLED.has(assignment.status)) continue
    const date = jstDateOf(assignment.scheduledAt)
    assignmentCount.set(date, (assignmentCount.get(date) ?? 0) + 1)
  }

  const cells: ShiftCell[] = dates.map(date => {
    const assigned = assignmentCount.get(date) ?? 0
    const confirmed = confirmedByDate.get(date)
    const day = dayProjection(confirmed, availabilityByDate.get(date))
    return {
      date,
      kind: assigned > 0 ? 'assigned' : day.kind,
      assignments: assigned,
      inLongStreak: false,
      confirmed: confirmed ?? null,
    }
  })

  // Streaks are detected over a padded window so a run crossing the month
  // boundary (e.g. Jun 28 – Jul 3) is still caught; only this month's cells
  // are rendered and highlighted.
  const cellByDate = new Map(cells.map(cell => [cell.date, cell]))
  const first = dates[0]
  const last = dates[dates.length - 1]
  const paddedDates = first === undefined || last === undefined ? [] : [
    ...Array.from({ length: STREAK_WARNING_DAYS }, (_, i) => shiftDate(first, i - STREAK_WARNING_DAYS)),
    ...dates,
    ...Array.from({ length: STREAK_WARNING_DAYS }, (_, i) => shiftDate(last, i + 1)),
  ]

  let maxStreak = 0
  let runStart = 0
  for (let index = 0; index <= paddedDates.length; index += 1) {
    const date = paddedDates[index]
    const working = date !== undefined && (
      (assignmentCount.get(date) ?? 0) > 0
      || dayProjection(confirmedByDate.get(date), availabilityByDate.get(date)).working
    )
    if (working) continue
    const run = paddedDates.slice(runStart, index)
    const overlapsMonth = run.some(day => cellByDate.has(day))
    if (overlapsMonth && run.length > maxStreak) maxStreak = run.length
    if (run.length >= STREAK_WARNING_DAYS) {
      for (const day of run) {
        const cell = cellByDate.get(day)
        if (cell) cell.inLongStreak = true
      }
    }
    runStart = index + 1
  }

  return {
    caddieProfileId: profile.id,
    employmentStatus: employmentStatus(profile.employmentStatus),
    cells,
    maxStreak,
  }
}
