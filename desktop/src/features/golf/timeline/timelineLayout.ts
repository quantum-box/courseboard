import type {
  AssignmentCoverage,
  TeeReservation,
  TimelineAssignment,
  TimelineBlock,
  TimelineWindow,
} from './models'

export const DEFAULT_TIMELINE_WINDOW: TimelineWindow = {
  startMinutes: 6 * 60,
  endMinutes: 18 * 60,
}

/** Horizontal scale: how many CSS pixels one hour occupies on the track. */
export const DEFAULT_PX_PER_HOUR = 140
export const MIN_PX_PER_HOUR = 64
export const MAX_PX_PER_HOUR = 280
export const PX_PER_HOUR_STEP = 16

export function clampPxPerHour(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PX_PER_HOUR
  return Math.min(MAX_PX_PER_HOUR, Math.max(MIN_PX_PER_HOUR, value))
}

export function windowDurationHours(window: TimelineWindow = DEFAULT_TIMELINE_WINDOW): number {
  return Math.max((window.endMinutes - window.startMinutes) / 60, 1)
}

export function trackWidthPx(
  pxPerHour: number,
  window: TimelineWindow = DEFAULT_TIMELINE_WINDOW,
): number {
  return Math.round(windowDurationHours(window) * clampPxPerHour(pxPerHour))
}

export function markStepMinutes(pxPerHour: number): number {
  const scale = clampPxPerHour(pxPerHour)
  if (scale >= 180) return 15
  if (scale >= 100) return 30
  return 60
}

export function zoomPercent(pxPerHour: number): number {
  return Math.round((clampPxPerHour(pxPerHour) / DEFAULT_PX_PER_HOUR) * 100)
}

export function parseLocalDateParts(iso: string): { date: string; minutes: number } {
  const match = iso.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
  )
  if (!match) {
    const fallback = new Date(iso)
    if (Number.isNaN(fallback.getTime())) {
      return { date: '1970-01-01', minutes: 0 }
    }
    const date = [
      fallback.getFullYear(),
      String(fallback.getMonth() + 1).padStart(2, '0'),
      String(fallback.getDate()).padStart(2, '0'),
    ].join('-')
    return {
      date,
      minutes: fallback.getHours() * 60 + fallback.getMinutes(),
    }
  }
  const hours = Number(match[2])
  const minutes = Number(match[3])
  return {
    date: match[1]!,
    minutes: hours * 60 + minutes,
  }
}

const JST_TIME_ZONE = 'Asia/Tokyo'
const DEFAULT_ASSIGNMENT_DURATION_MINUTES = 270

/** Convert any ISO timestamp to JST calendar date + wall-clock minutes. */
export function parseJstDateParts(iso: string): { date: string; minutes: number } {
  // Prefer explicit +09:00 wall-clock digits (tee-sheet / mock contract).
  if (/[+-]09:00$/.test(iso) || /\+0900$/.test(iso)) {
    return parseLocalDateParts(iso)
  }
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return parseLocalDateParts(iso)
  }
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: JST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed)
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
  return { date, minutes: hour * 60 + minute }
}

export function resolveAssignmentDurationMinutes(
  assignment: TimelineAssignment,
  reservations: TeeReservation[],
): number {
  if (typeof assignment.durationMinutes === 'number' && assignment.durationMinutes > 0) {
    return assignment.durationMinutes
  }
  const linked = reservations.find(item => item.id === assignment.reservationId)
  if (linked && linked.durationMinutes > 0) {
    return linked.durationMinutes
  }
  return DEFAULT_ASSIGNMENT_DURATION_MINUTES
}

/** Attach duration from tee-sheet when Field API omits durationMinutes. */
export function enrichAssignmentsForTimeline(
  assignments: TimelineAssignment[],
  reservations: TeeReservation[],
): TimelineAssignment[] {
  return assignments.map(assignment => ({
    ...assignment,
    durationMinutes: resolveAssignmentDurationMinutes(assignment, reservations),
  }))
}

export function minutesToLabel(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function buildHourMarks(window: TimelineWindow, stepMinutes = 60): number[] {
  const marks: number[] = []
  for (let cursor = window.startMinutes; cursor <= window.endMinutes; cursor += stepMinutes) {
    marks.push(cursor)
  }
  return marks
}

export function toTimelineBlock(
  id: string,
  startMinutes: number,
  durationMinutes: number,
  window: TimelineWindow = DEFAULT_TIMELINE_WINDOW,
): TimelineBlock {
  const span = Math.max(window.endMinutes - window.startMinutes, 1)
  const clampedStart = Math.max(startMinutes, window.startMinutes)
  const rawEnd = startMinutes + Math.max(durationMinutes, 15)
  const clampedEnd = Math.min(rawEnd, window.endMinutes)
  const leftPct = ((clampedStart - window.startMinutes) / span) * 100
  const widthPct = Math.max(((clampedEnd - clampedStart) / span) * 100, 0.8)
  return {
    id,
    startMinutes: clampedStart,
    endMinutes: clampedEnd,
    leftPct,
    widthPct,
  }
}

export function nowLinePercent(
  nowIso: string,
  date: string,
  window: TimelineWindow = DEFAULT_TIMELINE_WINDOW,
): number | null {
  const parts = parseLocalDateParts(nowIso)
  if (parts.date !== date) return null
  if (parts.minutes < window.startMinutes || parts.minutes > window.endMinutes) return null
  const span = Math.max(window.endMinutes - window.startMinutes, 1)
  return ((parts.minutes - window.startMinutes) / span) * 100
}

export function coverageForReservation(
  reservation: TeeReservation,
  assignments: TimelineAssignment[],
): AssignmentCoverage {
  if (reservation.playType === 'self') return 'not_required'
  const linked = assignments.filter(item => item.reservationId === reservation.id)
  if (linked.length === 0) return 'unassigned'
  const primary = linked.some(item => item.assignmentRole === 'primary' || item.assignmentRole === 'lead')
  return primary ? 'assigned' : 'partial'
}

export function findOverlappingAssignmentIds(assignments: TimelineAssignment[]): Set<string> {
  const byCaddie = new Map<string, TimelineAssignment[]>()
  for (const assignment of assignments) {
    const list = byCaddie.get(assignment.caddieProfileId) ?? []
    list.push(assignment)
    byCaddie.set(assignment.caddieProfileId, list)
  }

  const conflicts = new Set<string>()
  for (const list of byCaddie.values()) {
    const sorted = [...list].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i]!
      const currentStart = parseJstDateParts(current.scheduledAt).minutes
      const currentDuration = current.durationMinutes ?? DEFAULT_ASSIGNMENT_DURATION_MINUTES
      const currentEnd = currentStart + Math.max(currentDuration, 15)
      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j]!
        const nextStart = parseJstDateParts(next.scheduledAt).minutes
        if (nextStart >= currentEnd) break
        const nextDuration = next.durationMinutes ?? DEFAULT_ASSIGNMENT_DURATION_MINUTES
        const nextEnd = nextStart + Math.max(nextDuration, 15)
        if (nextStart < currentEnd && nextEnd > currentStart) {
          conflicts.add(current.id)
          conflicts.add(next.id)
        }
      }
    }
  }
  return conflicts
}

export function summarizeDay(
  reservations: TeeReservation[],
  assignments: TimelineAssignment[],
) {
  const caddieRequired = reservations.filter(item => item.playType === 'caddie')
  let assigned = 0
  let unassigned = 0
  let partial = 0
  for (const reservation of caddieRequired) {
    const coverage = coverageForReservation(reservation, assignments)
    if (coverage === 'assigned') assigned += 1
    else if (coverage === 'partial') partial += 1
    else unassigned += 1
  }
  const selfPlay = reservations.length - caddieRequired.length
  const coverageRate = caddieRequired.length === 0
    ? 1
    : assigned / caddieRequired.length
  return {
    total: reservations.length,
    caddieRequired: caddieRequired.length,
    selfPlay,
    assigned,
    unassigned,
    partial,
    coverageRate,
    conflicts: findOverlappingAssignmentIds(assignments).size,
  }
}

export function formatCoverageLabel(coverage: AssignmentCoverage): string {
  switch (coverage) {
    case 'assigned':
      return '割当済'
    case 'partial':
      return '一部割当'
    case 'unassigned':
      return '未割当'
    case 'not_required':
      return 'セルフ'
  }
}
