import type { PartyPlayer } from './models'

/** One player row while a new booking is being entered. */
export type DraftReservationPlayer = {
  name: string
  tag: string
  memberNumber: string
  /** Ledger identity the desk picked for this seat, if any. */
  customerId: string | null
}

export function emptyReservationPlayer(): DraftReservationPlayer {
  return { name: '', tag: '', memberNumber: '', customerId: null }
}

export function reservationPlayerRows(count: number): DraftReservationPlayer[] {
  return Array.from({ length: Math.max(count, 1) }, emptyReservationPlayer)
}

function hasAnyPlayerDetail(player: DraftReservationPlayer): boolean {
  return Boolean(player.name.trim() || player.tag.trim() || player.memberNumber.trim())
}

/**
 * Keep the roster aligned to headcount without throwing away a name the desk
 * already entered before reducing the count.
 */
export function resizeReservationPlayerRows(
  players: DraftReservationPlayer[],
  count: number,
): DraftReservationPlayer[] {
  const target = Math.max(count, 1)
  if (players.length < target) {
    return [...players, ...reservationPlayerRows(target - players.length)]
  }
  if (players.length > target && players.slice(target).every(player => !hasAnyPlayerDetail(player))) {
    return players.slice(0, target)
  }
  return players
}

export function hasUnnamedReservationPlayer(players: DraftReservationPlayer[]): boolean {
  return players.some(
    player =>
      !player.name.trim()
      && Boolean(player.tag.trim() || player.memberNumber.trim()),
  )
}

/** Entirely blank rows are placeholders and are not persisted. */
export function toReservationPlayers(players: DraftReservationPlayer[]): PartyPlayer[] {
  return players
    .filter(player => player.name.trim().length > 0)
    .map(player => ({
      name: player.name.trim(),
      ...(player.tag.trim() ? { tag: player.tag.trim() } : {}),
      ...(player.memberNumber.trim() ? { memberNumber: player.memberNumber.trim() } : {}),
      ...(player.customerId ? { customerId: player.customerId } : {}),
    }))
}

/** Seats the desk has identified, out of the ones it has named. */
export function linkedReservationPlayerCount(players: DraftReservationPlayer[]): number {
  return players.filter(player => player.name.trim().length > 0 && player.customerId).length
}
