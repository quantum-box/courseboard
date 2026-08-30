import { courseboardApiJson } from '../../../api'

/** One person the desk saw arrive, for one round. */
export type VisitCheckin = {
  reservationId: string
  /** Seat in the group, zero-based, as the saved roster orders them. */
  playerIndex: number
  /** Who this turned out to be in the ledger, when the desk has decided. */
  customerId?: string | null
  playerName: string
  /** Local calendar day of play, worked out upstream from the tee time. */
  playedOn: string
  checkedInAt: string
  checkedInBy?: string | null
}

export type VisitCheckinList = { items: VisitCheckin[] }

export type CheckinPlayer = {
  playerIndex: number
  customerId?: string | null
  playerName: string
}

export function reservationCheckinsPath(reservationId: string): string {
  return `/v1/course/reservations/${encodeURIComponent(reservationId)}/checkins`
}

export function listReservationCheckins(reservationId: string) {
  return courseboardApiJson<VisitCheckinList>(reservationCheckinsPath(reservationId))
}

/**
 * Records the seats that turned up.
 *
 * Sent as a set because a group walks up together, and a call per seat is a
 * call per seat that can fail on its own. Idempotent upstream: pressing the
 * button twice is one arrival, and a later press may correct who a seat turned
 * out to be.
 */
export function recordReservationCheckins(reservationId: string, players: CheckinPlayer[]) {
  return courseboardApiJson<VisitCheckinList>(reservationCheckinsPath(reservationId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ players }),
  })
}

/** The seats already recorded, keyed by their place in the roster. */
export function checkinsBySeat(items: readonly VisitCheckin[]): Map<number, VisitCheckin> {
  const bySeat = new Map<number, VisitCheckin>()
  for (const item of items) bySeat.set(item.playerIndex, item)
  return bySeat
}
