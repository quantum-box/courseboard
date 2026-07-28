/**
 * Pure layout logic for the shift board: one row per caddie, one cell per day,
 * plus consecutive-working-day detection. Kept free of React so it can be
 * tested directly.
 */

export type ShiftAvailability = {
  caddieProfileId: string
  date: string
  status: string
}

export type ShiftAssignment = {
  caddieProfileId: string
  scheduledAt: string
  status: string
}

export type ShiftCellKind =
  | 'assigned'
  | 'off'
  | 'morning'
  | 'afternoon'
  | 'light'
  | 'none'

export type ShiftCell = {
  date: string
  kind: ShiftCellKind
  assignments: number
  /** Part of a run of working days at or above the warning threshold. */
  inLongStreak: boolean
}

export type ShiftRow = {
  caddieProfileId: string
  cells: ShiftCell[]
  maxStreak: number
}

/** One shift-free day per week means at most six working days in a row. */
export const STREAK_WARNING_DAYS = 6

const CANCELLED = new Set(['cancelled', 'canceled'])

export function monthDates(yearMonth: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth)
  if (!match) return []
  const year = Number(match[1])
  const month = Number(match[2])
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: days }, (_, index) => (
    `${yearMonth}-${String(index + 1).padStart(2, '0')}`
  ))
}

function availabilityKind(status: string): ShiftCellKind {
  if (status === 'unavailable') return 'off'
  if (status === 'morning_only') return 'morning'
  if (status === 'afternoon_only') return 'afternoon'
  if (status === 'light_duty') return 'light'
  return 'none'
}

export function buildShiftRow(
  caddieProfileId: string,
  dates: string[],
  availabilities: ShiftAvailability[],
  assignments: ShiftAssignment[],
): ShiftRow {
  const availabilityByDate = new Map<string, string>()
  for (const entry of availabilities) {
    if (entry.caddieProfileId === caddieProfileId) {
      availabilityByDate.set(entry.date, entry.status)
    }
  }
  const assignmentCount = new Map<string, number>()
  for (const assignment of assignments) {
    if (assignment.caddieProfileId !== caddieProfileId) continue
    if (CANCELLED.has(assignment.status)) continue
    const date = assignment.scheduledAt.slice(0, 10)
    assignmentCount.set(date, (assignmentCount.get(date) ?? 0) + 1)
  }

  const cells: ShiftCell[] = dates.map(date => {
    const assigned = assignmentCount.get(date) ?? 0
    return {
      date,
      kind: assigned > 0 ? 'assigned' : availabilityKind(availabilityByDate.get(date) ?? ''),
      assignments: assigned,
      inLongStreak: false,
    }
  })

  // Mark runs of assigned days that reach the warning threshold.
  let maxStreak = 0
  let runStart = 0
  for (let index = 0; index <= cells.length; index += 1) {
    const working = index < cells.length && cells[index]!.kind === 'assigned'
    if (working) continue
    const runLength = index - runStart
    if (runLength > maxStreak) maxStreak = runLength
    if (runLength >= STREAK_WARNING_DAYS) {
      for (let mark = runStart; mark < index; mark += 1) cells[mark]!.inLongStreak = true
    }
    runStart = index + 1
  }

  return { caddieProfileId, cells, maxStreak }
}
