import { courseboardApiJson } from '../../api'
import { normalizeIsoDate } from '../../lib/clock'
import { summarizeLedger } from '../golf/ledger/ledgerLayout'
import type { LedgerColumn, TeeLedgerResponse } from '../golf/ledger/models'

/** Use the same read model and arithmetic as the reservation ledger's header. */
export async function getReservationStatus(
  args: { date?: unknown; golfCourseIds?: unknown },
  signal: AbortSignal,
  defaultDate: string,
) {
  const date = normalizeIsoDate(args.date ?? defaultDate)
  if (!date) throw new Error('A valid reservation date (YYYY-MM-DD) is required')
  const courseIds = args.golfCourseIds ?? []
  if (!Array.isArray(courseIds) || courseIds.length > 50 || courseIds.some(id => typeof id !== 'string' || !id.trim() || id.includes(','))) {
    throw new Error('Invalid course filter')
  }
  const query = new URLSearchParams({ date })
  if (courseIds.length) query.set('golfCourseIds', courseIds.join(','))
  const value = await courseboardApiJson<TeeLedgerResponse>(`/v1/course/tee-ledger?${query}`, { signal })
  return reservationStatusFromLedger(value, date, courseIds)
}

export function reservationStatusFromLedger(value: TeeLedgerResponse, date: string, courseIds: string[] = []) {
  if (!value || value.date !== date || typeof value.timezone !== 'string' || !value.timezone || !Array.isArray(value.columns)
    || (value.unavailable !== undefined && (!Array.isArray(value.unavailable) || value.unavailable.some(name => typeof name !== 'string')))) {
    throw new Error('Reservation ledger is unavailable or returned a different date')
  }
  const numbers = ['groupCount', 'playerCount', 'selfGroupCount', 'caddieGroupCount', 'openSlotCount'] as const
  for (const column of value.columns) {
    if (!column || typeof column.courseName !== 'string' || typeof column.golfCourseId !== 'string'
      || typeof column.gridSource !== 'string' || numbers.some(key => !Number.isSafeInteger(column[key]) || column[key] < 0)) {
      throw new Error('Incomplete reservation ledger counts')
    }
  }
  const totals = summarizeLedger(value.columns)
  const complete = value.columns.length > 0 && !value.unavailable?.length
  const count = ({ groups, players, selfGroups, caddieGroups }: ReturnType<typeof summarizeLedger>) => ({ groups, players, selfGroups, caddieGroups })
  return {
    source: '/v1/course/tee-ledger',
    sourceLabel: '予約台帳 / reservation ledger',
    date: value.date,
    timezone: value.timezone,
    scope: courseIds.length ? { golfCourseIds: courseIds } : 'all courses shown in the reservation ledger',
    complete,
    // Partial/unavailable reads must never be presented as a complete zero.
    reservationTotals: complete ? count(totals) : null,
    observedTotals: count(totals),
    remainingCapacity: { knownOpenSlots: totals.openSlots, uncountedCourses: totals.uncountedCourses, complete: complete && totals.uncountedCourses === 0 },
    unavailable: value.unavailable ?? [],
    guidance: complete ? 'Use reservationTotals as the authoritative reservation ledger counts for this date and scope.' : 'The ledger is incomplete or has no course columns. Do not claim there are zero reservations or present observedTotals as complete.',
    courses: value.columns.map((column: LedgerColumn) => ({ courseId: column.golfCourseId, courseName: column.courseName, groups: column.groupCount, players: column.playerCount, selfGroups: column.selfGroupCount, caddieGroups: column.caddieGroupCount })),
  }
}

export type ReservationStatus = ReturnType<typeof reservationStatusFromLedger>

/** Course names and per-course figures are rendered verbatim by the host, not recopied by the model. */
export function reservationStatusForModel(status: ReservationStatus) {
  const { courses, ...summary } = status
  return { ...summary, courseCount: courses.length, courseBreakdownRenderedByHost: true,
    guidance: `${status.guidance} The host has already displayed the exact course-by-course table. Do not recreate it or infer course names or per-course figures. Refer the user to that table.` }
}
