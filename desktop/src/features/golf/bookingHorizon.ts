/**
 * How far ahead the club sells, as the policy screen edits it.
 *
 * Two shapes, one setting. A course open all year keeps a rolling window — a
 * day count that always means the same distance ahead. A course with a season
 * has a closing date its book cannot cross, and counting days to it would mean
 * editing the number every week to hold the same date.
 */

export type HorizonMode = 'days' | 'through'

export type HorizonDraft = {
  mode: HorizonMode
  /** Kept while the other mode is showing, so switching back does not clear it. */
  days: string
  through: string
}

export type BookingHorizonResponse = {
  mode: HorizonMode
  days?: number | null
  through?: string | null
  bookableThrough: string
}

export type HorizonIssue = 'days' | 'through'

export const HORIZON_MIN_DAYS = 1
/** One short of the generate cap: the range is `today ..= today + days`. */
export const HORIZON_MAX_DAYS = 399

export function emptyHorizonDraft(): HorizonDraft {
  return { mode: 'days', days: '', through: '' }
}

export function horizonDraftFrom(response: BookingHorizonResponse): HorizonDraft {
  return {
    mode: response.mode === 'through' ? 'through' : 'days',
    days: response.days == null ? '' : String(response.days),
    through: response.through ?? '',
  }
}

/** What to send: only the field the chosen mode is about. */
export function horizonPayload(draft: HorizonDraft): { days: number } | { through: string } {
  return draft.mode === 'through'
    ? { through: draft.through }
    : { days: Number(draft.days) }
}

/**
 * Whether the draft says something the API will accept, checked against the
 * club's own today rather than the browser's — a desk in Japan opening this at
 * 08:00 on the 1st is already a day ahead of a UTC clock.
 */
export function horizonIssue(draft: HorizonDraft, today: string): HorizonIssue | null {
  if (draft.mode === 'through') {
    const value = draft.through.trim()
    if (!isCalendarDate(value)) return 'through'
    if (value < today) return 'through'
    if (value > addDays(today, HORIZON_MAX_DAYS)) return 'through'
    return null
  }
  const days = Number(draft.days)
  if (
    draft.days.trim() === ''
    || !Number.isInteger(days)
    || days < HORIZON_MIN_DAYS
    || days > HORIZON_MAX_DAYS
  ) {
    return 'days'
  }
  return null
}

/**
 * Only the chosen mode's value counts.
 *
 * Writing the horizon rebuilds every course's tee times, so an unrelated policy
 * save must not set that off just because the other mode's box still holds what
 * the club typed before switching.
 */
export function sameHorizon(left: HorizonDraft, right: HorizonDraft): boolean {
  if (left.mode !== right.mode) return false
  return left.mode === 'through'
    ? left.through.trim() === right.through.trim()
    : left.days.trim() === right.days.trim()
}

/**
 * A real day on the calendar, not merely digits in the right places.
 *
 * The shape alone would take `2026-13-01`, and comparing that as text puts it
 * inside a window it is not in — every month-13 date sorts before the following
 * January.
 */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  return parsed.toISOString().slice(0, 10) === value
}

/** `YYYY-MM-DD` plus a number of days, in plain calendar arithmetic. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days))
  return shifted.toISOString().slice(0, 10)
}
