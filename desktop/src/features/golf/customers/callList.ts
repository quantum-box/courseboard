import type { CustomerGradeVerdict } from './visits'

/**
 * One person on the call list.
 *
 * The figures are CourseBoard's, worked out ahead of time by the summary
 * refresh; the name and the phone number are Field's, read for the rows on this
 * page only. Both can be absent for different reasons and the screen has to
 * tell them apart: no phone number means nobody can ring this person, while a
 * missing name means the ledger would not answer about them.
 */
export type CustomerSummaryRow = {
  customerId: string
  name?: string | null
  nameKana?: string | null
  phone?: string | null
  visits: number
  players: number
  totalAmount: number
  unpricedVisits: number
  spendPerPlayer?: number | null
  cancelled: number
  noShows: number
  upcoming: number
  firstVisitAt?: string | null
  lastVisitAt?: string | null
  /** The refresh stopped short of this person's beginning; no grade is given. */
  truncated: boolean
  grade: CustomerGradeVerdict
  gradeName?: string | null
}

/** How the last refresh went, so the screen can say how old the figures are. */
export type CustomerSummaryRun = {
  startedAt: string
  finishedAt?: string | null
  status: 'running' | 'succeeded' | 'failed'
  reservationsScanned: number
  customersWritten: number
  error?: string | null
}

export type CustomerSummaryPage = {
  items: CustomerSummaryRow[]
  /** How many people the filters selected, not how many came back. */
  total: number
  lastRun?: CustomerSummaryRun | null
}

/** The three orders a call list is built in. */
export type CallListSort = 'total_amount' | 'visits' | 'last_visit'

/** What the desk is asking for. Every field is a filter the segment applies. */
export type CallListFilters = {
  sort: CallListSort
  minDaysSinceLastVisit: string
  minVisits: string
  minTotalAmount: string
}

export const CALL_LIST_DEFAULTS: CallListFilters = {
  sort: 'total_amount',
  // Ninety days is the club's usual reading of "we have not seen them in a
  // while" — long enough that a monthly regular is not on the list, short
  // enough that a lapsing one still remembers the course.
  minDaysSinceLastVisit: '90',
  minVisits: '2',
  minTotalAmount: '',
}

/** Rows the list asks for at once. Matches the API's own cap. */
export const CALL_LIST_ROWS = 100

export const customerSummariesPath = '/v1/course/customer-summaries'

/**
 * A blank box asks nothing rather than asking for zero.
 *
 * "At least 0 visits" and "no minimum" select the same people today, but the
 * first would quietly start excluding somebody the day the filter learns about
 * negative adjustments, and a cleared box reading as a filter is confusing
 * either way.
 */
function positiveNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

export function callListQuery(filters: CallListFilters): string {
  const params = new URLSearchParams()
  params.set('sort', filters.sort)
  // Oldest absence first when ranking by when somebody last played; biggest
  // first for the two that are counts of something.
  if (filters.sort === 'last_visit') params.set('ascending', 'true')
  const days = positiveNumber(filters.minDaysSinceLastVisit)
  if (days !== null) params.set('minDaysSinceLastVisit', String(days))
  const visits = positiveNumber(filters.minVisits)
  if (visits !== null) params.set('minVisits', String(visits))
  const amount = positiveNumber(filters.minTotalAmount)
  if (amount !== null) params.set('minTotalAmount', String(amount))
  params.set('limit', String(CALL_LIST_ROWS))
  return `${customerSummariesPath}?${params.toString()}`
}

/**
 * How many days ago somebody last played, or `null` if they never have.
 *
 * Shown beside the date because "90 日前" is the thing being filtered on, and
 * a desk reading a bare date has to do the subtraction itself for every row.
 */
export function daysSince(instant: string | null | undefined, now: number): number | null {
  if (!instant) return null
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.floor((now - parsed) / 86_400_000))
}

/**
 * Whether the figures are old enough that the desk should be told.
 *
 * A refresh that quietly stopped running leaves a table of plausible numbers
 * and a morning spent ringing people who came in last week. Two days is the
 * point at which a nightly refresh has visibly missed one.
 */
export const STALE_AFTER_DAYS = 2

export function isStale(run: CustomerSummaryRun | null | undefined, now: number): boolean {
  if (!run) return false
  if (run.status !== 'succeeded') return true
  const age = daysSince(run.finishedAt ?? run.startedAt, now)
  return age !== null && age >= STALE_AFTER_DAYS
}
