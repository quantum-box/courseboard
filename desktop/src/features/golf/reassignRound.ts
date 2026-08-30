/**
 * Moving a round that is already placed, within the day.
 *
 * The desk does this all morning — somebody comes in late, a customer asks for
 * a particular caddie, two groups swap starts — and the only way through it
 * used to be cancelling the round and naming somebody again. Kept free of
 * React so the question "which groups could this round move to" can be tested
 * directly.
 */

import { holdsTheRound, roundIsStillOn, type CoverageAssignment } from './caddieRoundCoverage'

/** The parts of a tee-sheet row this module reads. */
export type MovableRoundRow = {
  id: string
  reservationNumber: string
  golfCourseId: string
  courseName: string
  teeTime: string
  playType: string
  partySize: number
  partyName?: string
  status?: string
}

/** The parts of an assignment this module reads. */
export type MovableAssignment = CoverageAssignment & {
  id: string
  caddieProfileId: string
}

/** One group the round could be moved to, and what stands in the way. */
export type ReassignTarget = {
  reservationId: string
  teeTime: string
  courseName: string
  golfCourseId: string
  partyLabel: string
  partySize: number
  /** The caddie already on it, when it is somebody other than this round's. */
  heldBy: string | null
  /** The group this round is on now. */
  isCurrent: boolean
}

/**
 * The day's caddie-attached groups, in start order, each saying whether it is
 * free.
 *
 * A group somebody else holds is still listed: the desk is looking for a
 * particular group, and a picker that silently hides half the morning reads as
 * a board that lost the booking. It is marked instead, and the API refuses the
 * move for the same reason.
 */
export function reassignTargets({
  rows,
  assignments,
  caddieNames,
  currentAssignmentId,
}: {
  rows: MovableRoundRow[]
  assignments: MovableAssignment[]
  caddieNames: Map<string, string>
  currentAssignmentId: string
}): ReassignTarget[] {
  const live = assignments.filter(holdsTheRound)
  const holderOf = new Map<string, MovableAssignment>()
  for (const assignment of live) {
    if (assignment.id === currentAssignmentId) continue
    if (!assignment.reservationId) continue
    if (!holderOf.has(assignment.reservationId)) holderOf.set(assignment.reservationId, assignment)
  }
  const currentReservationId = live.find(
    assignment => assignment.id === currentAssignmentId,
  )?.reservationId ?? null

  return rows
    .filter(roundIsStillOn)
    .filter(row => row.playType === 'caddie')
    .sort((left, right) => left.teeTime.localeCompare(right.teeTime))
    .map(row => {
      const holder = holderOf.get(row.id)
      return {
        reservationId: row.id,
        teeTime: row.teeTime,
        courseName: row.courseName,
        golfCourseId: row.golfCourseId,
        partyLabel: row.partyName || row.reservationNumber,
        partySize: row.partySize,
        heldBy: holder
          ? caddieNames.get(holder.caddieProfileId) ?? holder.caddieProfileId
          : null,
        isCurrent: row.id === currentReservationId,
      }
    })
}

/** What the API would refuse, so the sheet can say it before the round trip. */
export function reassignBlocked({
  target,
  caddieProfileId,
  currentCaddieProfileId,
}: {
  target: ReassignTarget | null
  caddieProfileId: string
  currentCaddieProfileId: string
}): 'noTarget' | 'taken' | 'unchanged' | null {
  if (!target) return 'noTarget'
  if (target.heldBy !== null) return 'taken'
  if (target.isCurrent && caddieProfileId === currentCaddieProfileId) return 'unchanged'
  return null
}
