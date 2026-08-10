import type { DraftReservationPlayer } from './newReservationPlayers'

/**
 * A name on a booking that nobody has matched to the customer ledger.
 *
 * `role` is what the prompt needs to tell the desk which line it is asking
 * about, and it is also what decides whether the answer can be written back:
 * a player sits in the booking's custom fields and can be linked afterwards,
 * while the booker sits in `reservations.customer_id`, which Field only accepts
 * at creation (PLT-3379).
 */
export type UnregisteredName = {
  name: string
  role: 'booker' | 'player'
  /** Index into the party roster; absent for the booker. */
  playerIndex?: number
}

/**
 * The names this booking just wrote down without saying who they are.
 *
 * The desk types a booking under time pressure and is not going to stop and
 * search the ledger four times. So the booking goes in as free text, and this
 * is what the follow-up question is built from — everything named but not
 * identified.
 *
 * Someone the desk *did* pick from the ledger is not here: they are already
 * known. Neither is a blank row, which is a seat nobody has filled rather than
 * a person nobody has registered.
 */
export function unregisteredNames(
  booker: { name: string; customerId: string | null },
  players: readonly DraftReservationPlayer[],
): UnregisteredName[] {
  const found: UnregisteredName[] = []
  const seen = new Set<string>()

  const bookerName = booker.name.trim()
  if (bookerName && !booker.customerId) {
    found.push({ name: bookerName, role: 'booker' })
    seen.add(bookerName)
  }

  players.forEach((player, playerIndex) => {
    const name = player.name.trim()
    if (!name || player.customerId) return
    // The booker is usually also playing, and their name is typed twice. Asking
    // twice about one person would register them twice, which is exactly the
    // duplicate the ledger exists to avoid.
    if (seen.has(name)) return
    seen.add(name)
    found.push({ name, role: 'player', playerIndex })
  })

  return found
}
