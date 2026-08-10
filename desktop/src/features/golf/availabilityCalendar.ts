import { COURSE_TIME_ZONE } from '../../lib/clock'
import { isSupportedTimezone } from '../../lib/timezone'

export type CalendarDateSelection = {
  anchor: string | null
  dates: string[]
}

export function emptyCalendarDateSelection(): CalendarDateSelection {
  return { anchor: null, dates: [] }
}

function utcDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new RangeError(`Invalid calendar date: ${date}`)
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (value.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid calendar date: ${date}`)
  }
  return value
}

/** Inclusive, chronological dates between two calendar dates. */
export function calendarDateRange(from: string, to: string) {
  const start = utcDate(from)
  const end = utcDate(to)
  const first = Math.min(start.getTime(), end.getTime())
  const last = Math.max(start.getTime(), end.getTime())
  const dates: string[] = []
  for (let value = first; value <= last; value += 86_400_000) {
    dates.push(new Date(value).toISOString().slice(0, 10))
  }
  return dates
}

/**
 * A plain click establishes a stable anchor. Shift+click replaces the current
 * selection with the complete inclusive range from that anchor; it never
 * toggles individual dates, so an existing mixed selection cannot leave holes.
 */
export function calendarSelectionAfterClick(
  current: CalendarDateSelection,
  clickedDate: string,
  shiftKey: boolean,
): CalendarDateSelection {
  if (!shiftKey || !current.anchor) {
    return { anchor: clickedDate, dates: [clickedDate] }
  }
  return {
    anchor: current.anchor,
    dates: calendarDateRange(current.anchor, clickedDate),
  }
}

/** SCC-6 compatibility default, used only when the tenant key is absent/blank. */
export function tenantTimezoneFromConfig(config?: Record<string, unknown> | null) {
  const configured = config?.timezone
  if (configured === undefined) return COURSE_TIME_ZONE
  if (typeof configured !== 'string') {
    throw new RangeError('Tenant timezone must be an IANA timezone name')
  }
  const timezone = configured.trim()
  if (!timezone) return COURSE_TIME_ZONE
  if (!isSupportedTimezone(timezone)) {
    throw new RangeError(`Unsupported tenant timezone: ${timezone}`)
  }
  return timezone
}

/** Calendar date at one fixed instant in the tenant timezone. */
export function calendarDateInTimezone(now: Date, timezone: string) {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid clock instant')
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function isCalendarToday(date: string, now: Date, timezone: string) {
  return date === calendarDateInTimezone(now, timezone)
}
