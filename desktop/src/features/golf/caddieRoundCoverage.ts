/** The parts of a caddie assignment this module needs to tell coverage apart. */
export type CoverageAssignment = {
  reservationId?: string | null
  status: string
  /** Canonical CourseBoard status; absent on older API responses. */
  canonicalStatus?: string | null
}

/** The parts of a bookable round this module needs to tell coverage apart. */
export type CoverableRound = { id: string; playType: string; status?: string }

/**
 * A round still has a caddie when the assignment is anything but cancelled: a
 * completed round was staffed, and re-offering it would double-book it.
 */
export function holdsTheRound(assignment: CoverageAssignment): boolean {
  if (assignment.canonicalStatus !== undefined && assignment.canonicalStatus !== null) {
    return assignment.canonicalStatus !== 'cancelled'
  }
  const raw = assignment.status.trim().toLowerCase()
  return raw !== 'cancelled' && raw !== 'canceled'
}

/** Whether a round is a group somebody is still going to play. */
export function roundIsStillOn(row: CoverableRound): boolean {
  return row.status !== 'cancelled' && row.status !== 'rejected'
}

export function unassignedCaddieRounds<T extends CoverableRound>(
  rows: T[],
  assignments: CoverageAssignment[],
): T[] {
  const covered = new Set(
    assignments
      .filter(holdsTheRound)
      .map(assignment => assignment.reservationId)
      .filter((id): id is string => Boolean(id)),
  )
  return rows
    .filter(roundIsStillOn)
    .filter(row => row.playType === 'caddie' && !covered.has(row.id))
}
