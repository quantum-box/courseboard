import type { GolfReservationProduct, PlayType } from '../models'
import type { SlotSelection } from './LedgerBoard'
import type { LedgerColumn, LedgerSlot } from './models'

export type ReservationTarget = {
  column: LedgerColumn
  slot: LedgerSlot
}

export type ReservationBlockReason =
  | 'full'
  | 'inactive'
  | 'missingInventory'
  | 'missingResource'
  | 'unavailable'

export function selectedReservationTarget(
  columns: LedgerColumn[],
  selection: SlotSelection | null,
): ReservationTarget | null {
  if (!selection || selection.teeTimes.length !== 1) return null
  const column = columns.find(item => item.golfCourseId === selection.golfCourseId)
  if (!column) return null
  const slot = column.slots.find(item => item.teeTime === selection.teeTimes[0])
  return slot ? { column, slot } : null
}

/**
 * What the current ledger snapshot already knows before Field is called.
 *
 * Derived rows deliberately cannot create reservations. Field would put them
 * in a compatibility `manual:` slot whose remaining count the board cannot
 * reconcile with generated inventory, so allowing it would make the visible
 * "open" count less trustworthy after the save.
 */
export function reservationBlockReason(
  target: ReservationTarget | null,
): ReservationBlockReason | null {
  if (!target) return 'unavailable'
  const { column, slot } = target
  if (!column.resourceId) return 'missingResource'
  if (column.gridSource !== 'inventory' || slot.availableGroups == null) {
    return 'missingInventory'
  }
  if (!slot.isActive || slot.mark?.kind === 'closed') return 'inactive'
  if (slot.availableGroups <= 0) return 'full'
  if (!slot.isSellable) return 'unavailable'
  return null
}

/** Same deterministic product choice as the CourseBoard use case. */
export function reservationProduct(
  products: GolfReservationProduct[],
  courseId: string,
  playType: PlayType,
): GolfReservationProduct | null {
  const sorted = products
    .filter(product => product.playType === playType)
    .sort((left, right) => left.reservationServiceId.localeCompare(right.reservationServiceId))
  return sorted.find(product => product.golfCourseId === courseId)
    ?? sorted.find(product => !product.golfCourseId)
    ?? null
}
