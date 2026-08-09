import { i18next } from '../../../i18n'

import type { TeeReservation } from '../timeline/models'
import type { LedgerColumn, LedgerSlot, SlotGridSource } from './models'

/** How a row reads at a glance. */
export type SlotTone =
  | 'open'
  | 'partial'
  | 'full'
  | 'closed'
  | 'retired'
  | 'special'

/**
 * The paper ledger draws four seats per group, and so does this one until a
 * course actually books something bigger.
 */
export const DEFAULT_SEAT_COLUMNS = 4
/** Matches the API's ceiling on a group. */
export const MAX_SEAT_COLUMNS = 8
/**
 * How many players the desk may put in one group.
 *
 * A tee-off is four balls, so that is what the desk can type. Separate from
 * [`MAX_SEAT_COLUMNS`] on purpose: a booking that already carries five players
 * still has to draw all five, and truncating one that Field accepted would
 * hide a player rather than prevent one.
 */
export const MAX_PARTY_PLAYERS = 4

/**
 * How many seat columns this course needs today.
 *
 * Widening for the largest group on the board rather than a fixed four keeps a
 * five-ball's fifth player from being cut off the sheet, while a course that
 * only sells four-balls never grows a permanently empty column.
 */
export function seatColumnCount(column: LedgerColumn): number {
  const largest = column.slots
    .flatMap(slot => slot.items)
    .reduce((max, item) => Math.max(max, item.partySize, item.party?.players.length ?? 0), 0)
  return Math.min(Math.max(largest, DEFAULT_SEAT_COLUMNS), MAX_SEAT_COLUMNS)
}

/**
 * What a row means, in the order the desk cares about.
 *
 * Retired and closed come first because both mean "not for sale", and a row
 * that is sold out for a reason nobody chose should not look the same as one
 * the desk deliberately shut.
 */
export function slotTone(slot: LedgerSlot): SlotTone {
  if (!slot.isActive) return 'retired'
  if (slot.mark?.kind === 'closed') return 'closed'
  if (slot.mark?.kind === 'special_rate') return 'special'
  if (slot.bookedGroups === 0) return 'open'
  if (slot.isSellable) return 'partial'
  return 'full'
}

/**
 * Groups still sellable on this row, or `null` when nothing counted them.
 *
 * `null` and `0` must not collapse into each other: a course that never
 * generated inventory would otherwise show every open tee time as full.
 */
export function remainingGroups(slot: LedgerSlot): number | null {
  if (typeof slot.availableGroups !== 'number') return null
  return Math.max(slot.availableGroups, 0)
}

/** `26組92人（セルフ10組）`, the way the paper column header reads. */
export function formatColumnTotals(column: LedgerColumn): string {
  return i18next.t('ledger:column.totals', {
    groups: String(column.groupCount),
    players: String(column.playerCount),
    self: String(column.selfGroupCount),
  })
}

export function formatGridSource(source: SlotGridSource): string {
  switch (source) {
    case 'inventory':
      return i18next.t('ledger:source.inventory')
    case 'schedule':
      return i18next.t('ledger:source.schedule')
    case 'opening_hours':
      return i18next.t('ledger:source.openingHours')
    case 'bookings_only':
      return i18next.t('ledger:source.bookingsOnly')
  }
}

/**
 * What to write in the group's name line.
 *
 * The competition wins when there is one: on a competition day the desk finds a
 * group by which competition it belongs to, not by whose card the booking is
 * under.
 */
export function groupTitle(item: TeeReservation): string {
  const competition = item.party?.competitionName?.trim()
  if (competition) {
    const number = item.party?.groupNumber
    return number ? `${competition} ${i18next.t('ledger:cell.groupNumber', { n: String(number) })}` : competition
  }
  return item.partyName?.trim() || i18next.t('ledger:cell.unnamed')
}

export type SeatCell =
  | { kind: 'player'; name: string; tag?: string | null }
  /** A seat on the booking with nobody's name against it yet. */
  | { kind: 'unnamed' }
  /** Past the end of this booking — not part of the group at all. */
  | { kind: 'empty' }

/**
 * One row of seats for a group, padded out to the column's width.
 *
 * The three kinds stay distinct because "we have not typed this name yet" and
 * "this group is only a three-ball" look identical if both render blank, and
 * the desk chases the first while ignoring the second.
 */
export function seatCells(item: TeeReservation, columns: number): SeatCell[] {
  const players = item.party?.players ?? []
  const booked = Math.max(item.partySize, players.length)
  return Array.from({ length: columns }, (_, index) => {
    const player = players[index]
    if (player) return { kind: 'player' as const, name: player.name, tag: player.tag }
    if (index < booked) return { kind: 'unnamed' as const }
    return { kind: 'empty' as const }
  })
}

/**
 * The tee times between two rows the operator picked, inclusive.
 *
 * The desk closes a band by clicking its first and last row, and the rows in
 * between come along whichever end was clicked first.
 */
export function teeTimesBetween(
  slots: LedgerSlot[],
  anchorTeeTime: string,
  focusTeeTime: string,
): string[] {
  const times = slots.map(slot => slot.teeTime)
  const start = times.indexOf(anchorTeeTime)
  const end = times.indexOf(focusTeeTime)
  if (start === -1 || end === -1) return []
  const [from, to] = start <= end ? [start, end] : [end, start]
  return times.slice(from, to + 1)
}

/** Rows in the ledger's own order, whatever order the API listed them in. */
export function sortSlots(slots: LedgerSlot[]): LedgerSlot[] {
  return [...slots].sort((left, right) => left.teeTime.localeCompare(right.teeTime))
}

/**
 * The day's totals across every column.
 *
 * `openSlots` counts rows the desk could still sell, which is what the header
 * on the paper ledger tracks — not rows that merely have no booking, since a
 * closed row has no booking either.
 */
export function summarizeLedger(columns: LedgerColumn[]) {
  return columns.reduce(
    (total, column) => ({
      groups: total.groups + column.groupCount,
      players: total.players + column.playerCount,
      selfGroups: total.selfGroups + column.selfGroupCount,
      caddieGroups: total.caddieGroups + column.caddieGroupCount,
      openSlots: total.openSlots + column.openSlotCount,
    }),
    { groups: 0, players: 0, selfGroups: 0, caddieGroups: 0, openSlots: 0 },
  )
}

/** `HH:MM` as minutes past midnight, or `null` when it is not a clock. */
export function teeTimeMinutes(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  return hour! * 60 + minute!
}

/**
 * The row the "now" marker sits on: the last one that has already started.
 *
 * Pinning to the next row instead would put the marker above a group that is
 * out on the course, which reads as if they had not teed off.
 */
export function currentSlotTeeTime(
  slots: LedgerSlot[],
  nowMinutes: number | null,
): string | null {
  if (nowMinutes === null) return null
  let current: string | null = null
  for (const slot of sortSlots(slots)) {
    const minutes = teeTimeMinutes(slot.teeTime)
    if (minutes === null || minutes > nowMinutes) break
    current = slot.teeTime
  }
  return current
}

/**
 * The gap between rows as the board actually draws them.
 *
 * The course record carries a start interval, but the rows come from the
 * week's opening bands, which set their own. A course configured at 7 minutes
 * whose bands generate every 8 was labelling its 8-minute rows "7分間隔".
 * Measured from the times on screen, so the label cannot disagree with them.
 *
 * Returns `null` when the column has fewer than two rows, or when the gaps are
 * uneven — a single number would be a lie about a board that changes pace.
 */
export function observedIntervalMinutes(column: LedgerColumn): number | null {
  const minutes = column.slots
    .map(slot => teeTimeMinutes(slot.teeTime))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)
  if (minutes.length < 2) return null

  const first = minutes[1]! - minutes[0]!
  for (let index = 2; index < minutes.length; index += 1) {
    if (minutes[index]! - minutes[index - 1]! !== first) return null
  }
  return first > 0 ? first : null
}

/**
 * Whether this column can say how many groups are still sellable.
 *
 * Only generated inventory counts capacity. A derived column knows which rows
 * carry no booking, which is not the same thing — showing that tally as
 * "空き N 枠" beside the notice saying the count is unknown had the header
 * contradicting the line under it.
 */
export function knowsRemainingCapacity(column: LedgerColumn): boolean {
  return column.gridSource === 'inventory'
}
