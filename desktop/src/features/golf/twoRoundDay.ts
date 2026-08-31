/**
 * Two-round days, as the boards need to show them.
 *
 * A caddie who asked for two rounds is planned onto an early group so a second
 * one can follow it, and the desk then spends the morning checking the pair
 * held: the request is the club's own supply figure, and a second round that
 * quietly went to somebody else is a caddie short on the day it was sold for.
 * Both boards mark the same two things — who asked, and which of their rounds
 * is the second — so the answer is the same wherever it is read.
 *
 * Kept free of React so the counting can be tested directly.
 */

import { holdsTheRound, type CoverageAssignment } from './caddieRoundCoverage'

/** The parts of an assignment this module reads. */
export type DayRoundAssignment = CoverageAssignment & {
  id: string
  caddieProfileId: string
  scheduledAt: string
}

/** The parts of a filed shift request this module reads. */
export type TwoRoundRequestRow = {
  caddieProfileId: string
  twoRoundRequest?: boolean | null
}

/**
 * The assignments that are the second round of somebody's day, or later.
 *
 * Counted per caddie in start order, and only over the rounds they still hold:
 * a cancelled first round does not make the round after it a second, which is
 * exactly the day the desk is trying to spot.
 *
 * `assignments` is one day's worth. Handed a longer span this would call the
 * next morning's first round a second, so the caller narrows it first — the
 * same day the board is showing.
 */
export function secondRoundAssignmentIds(assignments: DayRoundAssignment[]): Set<string> {
  const byCaddie = new Map<string, DayRoundAssignment[]>()
  for (const assignment of assignments.filter(holdsTheRound)) {
    const held = byCaddie.get(assignment.caddieProfileId)
    if (held) held.push(assignment)
    else byCaddie.set(assignment.caddieProfileId, [assignment])
  }

  const second = new Set<string>()
  for (const held of byCaddie.values()) {
    held
      // Two rounds starting at the same minute cannot both be walked, but the
      // board still has to name one of them as the second rather than order
      // them differently on every render.
      .sort((left, right) =>
        left.scheduledAt.localeCompare(right.scheduledAt) || left.id.localeCompare(right.id))
      .slice(1)
      .forEach(assignment => second.add(assignment.id))
  }
  return second
}

/** Who filed a two-round request for the day. */
export function twoRoundRequestIds(rows: TwoRoundRequestRow[]): Set<string> {
  return new Set(
    rows
      .filter(row => row.twoRoundRequest === true)
      .map(row => row.caddieProfileId),
  )
}
