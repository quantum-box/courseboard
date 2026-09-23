import { i18next } from '../../../i18n'
import { DEFAULT_TIME_ZONE } from '../../../lib/clock'

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

/** Where a course's tee ticks sit on the track, in CSS pixels. */
export type TeeTickGeometry = {
  stepPx: number
  offsetPx: number
}

/** Below this the ticks read as a smear rather than as countable slots. */
const MIN_TEE_STEP_PX = 4

/**
 * The tee-interval ruler for one course lane.
 *
 * A gap between two blocks means nothing until you know the cadence behind it;
 * with ticks, a gap is a number of open tee times you can count off the track.
 *
 * Ticks line up with the course's opening time, not with the window's, because
 * a course that opens at 07:00 on an 8-minute interval never starts a group on
 * the marks a 06:00 ruler would draw.
 *
 * `null` when the course has no usable interval or the ticks would be too dense
 * to read at this zoom.
 */
export function teeTickGeometry(
  intervalMinutes: number | null | undefined,
  pxPerHour: number,
  openMinutes: number | null | undefined,
  window: TimelineWindow = DEFAULT_TIMELINE_WINDOW,
): TeeTickGeometry | null {
  if (!intervalMinutes || intervalMinutes <= 0) return null
  const scale = clampPxPerHour(pxPerHour)
  const stepPx = (intervalMinutes / 60) * scale
  if (stepPx < MIN_TEE_STEP_PX) return null

  const anchor = openMinutes ?? window.startMinutes
  const shiftMinutes = (((anchor - window.startMinutes) % intervalMinutes) + intervalMinutes)
    % intervalMinutes
  return { stepPx, offsetPx: (shiftMinutes / 60) * scale }
}

/** `HH:MM` as minutes past midnight, or `null` when it is not a time. */
export function parseClockMinutes(value: string | null | undefined): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
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

const DEFAULT_ASSIGNMENT_DURATION_MINUTES = 270

/** Convert any ISO timestamp to tenant calendar date + wall-clock minutes. */
export function parseTenantDateParts(
  iso: string,
  timezone = DEFAULT_TIME_ZONE,
): { date: string; minutes: number } {
  // Tee-sheet values carry the tenant offset, so their wall-clock digits are
  // already authoritative. Assignment timestamps are normally UTC and take
  // the IANA conversion below.
  if (/[+-]\d{2}:?\d{2}$/.test(iso)) {
    return parseLocalDateParts(iso)
  }
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return parseLocalDateParts(iso)
  }
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed)
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
  return { date, minutes: hour * 60 + minute }
}

/** @deprecated Use parseTenantDateParts and pass the tenant timezone. */
export const parseJstDateParts = parseTenantDateParts

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

/**
 * Splits a lane's blocks into stacked sub-rows so overlapping bookings sit
 * below each other instead of on top of each other. Greedy interval
 * partitioning: each block takes the first sub-row that is free at its start.
 * Touch screens have no hover to peek under an overlap, so the layout itself
 * must keep every block visible.
 */
export function assignStackLanes(
  blocks: Array<Pick<TimelineBlock, 'id' | 'startMinutes' | 'endMinutes'>>,
): { lanes: Map<string, number>; laneCount: number } {
  const sorted = [...blocks].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  )
  const laneEnds: number[] = []
  const lanes = new Map<string, number>()
  for (const block of sorted) {
    let lane = laneEnds.findIndex(end => end <= block.startMinutes)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(block.endMinutes)
    } else {
      laneEnds[lane] = block.endMinutes
    }
    lanes.set(block.id, lane)
  }
  return { lanes, laneCount: Math.max(laneEnds.length, 1) }
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

export function findOverlappingAssignmentIds(
  assignments: TimelineAssignment[],
  timezone = DEFAULT_TIME_ZONE,
): Set<string> {
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
      const currentStart = parseTenantDateParts(current.scheduledAt, timezone).minutes
      const currentDuration = current.durationMinutes ?? DEFAULT_ASSIGNMENT_DURATION_MINUTES
      const currentEnd = currentStart + Math.max(currentDuration, 15)
      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j]!
        const nextStart = parseTenantDateParts(next.scheduledAt, timezone).minutes
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
  timezone = DEFAULT_TIME_ZONE,
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
    conflicts: findOverlappingAssignmentIds(assignments, timezone).size,
  }
}

export function formatCoverageLabel(coverage: AssignmentCoverage): string {
  switch (coverage) {
    case 'assigned':
      return i18next.t('timeline:coverage.assigned')
    case 'partial':
      return i18next.t('timeline:coverage.partial')
    case 'unassigned':
      return i18next.t('timeline:coverage.unassigned')
    case 'not_required':
      return i18next.t('timeline:coverage.self')
  }
}
