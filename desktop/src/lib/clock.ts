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
export const COURSE_TIME_ZONE = 'Asia/Tokyo'

/** Today on the course clock, as `YYYY-MM-DD`. */
export function today() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: COURSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Current course-local time as `YYYY-MM-DDTHH:mm`, recomputed on every call. */
export function nowIsoMinute() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: COURSE_TIME_ZONE,
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

export function currentYearMonth() {
  return today().slice(0, 7)
}
