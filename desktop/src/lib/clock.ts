/**
 * The clock the courses run on.
 *
 * Every "today" and "now" in the operator screens is this clock, never the
 * device's — a laptop left on a foreign timezone must still show the day the
 * course is actually working. The same reading is why a punch has to name the
 * working day it belongs to rather than let the server derive one from UTC.
 *
 * It lives here rather than in `api.ts` so that pure modules — timeline layout,
 * form defaults — can share it without pulling in fetch and auth.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Tokyo'
/** @deprecated Use the tenant timezone context for operator calculations. */
export const COURSE_TIME_ZONE = DEFAULT_TIME_ZONE

/** Today on the course clock, as `YYYY-MM-DD`. */
export function today(timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Current course-local time as `YYYY-MM-DDTHH:mm`, recomputed on every call. */
export function nowIsoMinute(timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(' ', 'T')
}

export function currentYearMonth(timeZone = DEFAULT_TIME_ZONE) {
  return today(timeZone).slice(0, 7)
}

/**
 * A `YYYY-MM-DD` day, or null when the value is not one.
 *
 * The boundary for days that arrive from outside the app — a link somebody
 * shortened, a hand-edited URL. The calendar check is the point: `2026-02-31`
 * matches the shape and is still a day no course ever works.
 */
export function normalizeIsoDate(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null
  const normalized = candidate.trim().normalize('NFKC')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null
  }
  return normalized
}

/**
 * A `YYYY-MM-DD` value written the way the locale writes a date.
 *
 * Parsed by parts on purpose: `new Date('2026-08-10')` is midnight UTC, which
 * reads as the 9th west of Greenwich — wrong by a day for a value nobody
 * attached a time to.
 */
export function formatCourseDate(iso: string, locale?: string) {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(year, month - 1, day))
}
