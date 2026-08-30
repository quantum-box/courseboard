import { customerPath } from './models'

/**
 * What a booking turned out to be, once the clock is applied to it.
 *
 * `other` is a booking in a state golf has no word for — waitlisted, suspended.
 * Rows carrying it show Field's own status instead of a label this app made up.
 */
export type VisitKind = 'visited' | 'upcoming' | 'no_show' | 'cancelled' | 'other'

/** One round, as the desk reads it. */
export type CustomerVisit = {
  reservationId: string
  reservationNumber: string
  /** UTC instant. Rendered in the tenant's timezone, never the device's. */
  startsAt: string
  courseId?: string | null
  players: number
  amount: number
  currency?: string | null
  kind: VisitKind
  /** Field's own status, worth showing only when `kind` is `other`. */
  status: string
  /**
   * Whether the booking is in this person's own name.
   *
   * False for a round they played in somebody else's group. Field records one
   * customer per reservation, so such a round only exists here because the desk
   * checked them in — and its money and headcount belong to whoever booked it,
   * which is why both come back as zero.
   */
  booked: boolean
  /**
   * Whether the desk recorded them arriving, as opposed to the tee time having
   * passed on a booking nobody cancelled. Everything from before check-ins were
   * kept is the latter, which is not a sign that nobody came.
   */
  checkedIn: boolean
}

export type CustomerVisitSummary = {
  visits: number
  /** Rounds sold across those visits: a foursome counts four. */
  players: number
  totalAmount: number
  /** Visits with no money on them, left out of `spendPerPlayer`. */
  unpricedVisits: number
  /** Absent when no visit carries money — unknown, not zero. */
  spendPerPlayer?: number | null
  cancelled: number
  noShows: number
  upcoming: number
  /** Absent whenever `truncated`: the oldest row read is not the first round. */
  firstVisitAt?: string | null
  lastVisitAt?: string | null
}

/**
 * Why somebody does or does not have a grade.
 *
 * Four answers rather than a nullable name: "this club grades nobody", "we
 * cannot tell from a partial history", and "they have not reached the lowest
 * rung" read differently on a screen, and collapsing them would put the club's
 * missing setup on the customer's record.
 */
export type CustomerGradeVerdict = 'graded' | 'below_lowest' | 'unknown' | 'not_configured'

export type CustomerVisitHistory = {
  items: CustomerVisit[]
  summary: CustomerVisitSummary
  /**
   * Reading gave up before the end of the history, which makes the figures a
   * partial count rather than a lifetime one.
   */
  truncated: boolean
  grade: CustomerGradeVerdict
  /** Set only when `grade` is `graded`. */
  gradeName?: string | null
}

/** One rung of the ladder a club sorts its regulars by. */
export type CustomerGradeRule = {
  name: string
  minVisits: number
  minSpendPerPlayer?: number | null
  minTotalAmount?: number | null
}

export type CustomerGradeRuleList = { items: CustomerGradeRule[] }

export const customerGradeRulesPath = '/v1/course/customer-grade-rules'

/** A rung the operator has started but not named yet is not a rung. */
export function isBlankGradeRule(rule: CustomerGradeRule): boolean {
  return rule.name.trim() === ''
}

export function customerVisitsPath(customerId: string): string {
  return `${customerPath(customerId)}/visits`
}

/**
 * How often this person plays, in rounds per year.
 *
 * Needs both ends of the history to mean anything, so it is `null` while the
 * history is truncated: dividing by the span of the page would report a
 * twenty-year member as a first-timer who plays constantly.
 *
 * A single visit gives no interval to measure, and neither does a span under a
 * month — two rounds a fortnight apart are not "26 a year" yet.
 */
export function roundsPerYear(summary: CustomerVisitSummary): number | null {
  const { firstVisitAt, lastVisitAt, visits } = summary
  if (!firstVisitAt || !lastVisitAt || visits < 2) return null
  const spanDays = (Date.parse(lastVisitAt) - Date.parse(firstVisitAt)) / 86_400_000
  if (!Number.isFinite(spanDays) || spanDays < 30) return null
  return Math.round((visits / spanDays) * 365 * 10) / 10
}

/**
 * The calendar date of a tee time in the tenant's timezone.
 *
 * The desk's day is the course's day: a laptop left on another timezone must
 * not move a morning round onto the previous date.
 */
export function visitDate(startsAt: string, timezone: string): string {
  const parsed = new Date(startsAt)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(parsed)
}

export function visitTime(startsAt: string, timezone: string): string {
  const parsed = new Date(startsAt)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}
