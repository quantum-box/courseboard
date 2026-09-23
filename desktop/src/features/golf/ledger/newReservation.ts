import type { SlotSelection } from './LedgerBoard'
import type { LedgerColumn, LedgerSlot } from './models'

export type ReservationTarget = {
  column: LedgerColumn
  slot: LedgerSlot
}

export type ReservationBlockReason =
  | 'full'
  | 'stopped'
  | 'missingInventory'
  | 'missingResource'
  | 'notSellable'

export function reservationTarget(
  columns: LedgerColumn[],
  golfCourseId: string,
  teeTime: string,
): ReservationTarget | null {
  const column = columns.find(item => item.golfCourseId === golfCourseId)
  if (!column) return null
  const slot = column.slots.find(item => item.teeTime === teeTime)
  return slot ? { column, slot } : null
}

export function selectedReservationTarget(
  columns: LedgerColumn[],
  selection: SlotSelection | null,
): ReservationTarget | null {
  if (!selection || selection.teeTimes.length !== 1) return null
  return reservationTarget(columns, selection.golfCourseId, selection.teeTimes[0]!)
}

/**
 * Explains what the current ledger snapshot already knows before Field is called.
 *
 * Rows derived from a schedule or opening hours are useful as a time ruler, but
 * they do not represent generated inventory. Sending a booking from one of
 * those rows would create a compatibility manual slot whose remaining count the
 * ledger cannot reconcile with generated inventory.
 */
/** The course's own screen, where its resource and tee times are set up. */
export function courseSetupRoute(golfCourseId: string): string {
  return `golf/courses/${encodeURIComponent(golfCourseId)}`
}

/**
 * The screen that puts this block right, when a screen can.
 *
 * `missingInventory` and `missingResource` are setup states rather than
 * statements about the day, and both are fixed in the same place: saving the
 * course's week links its resource and builds the tee times it describes. The
 * other three describe this row on this day, so there is nothing to open — a
 * link on "満枠" would send the desk somewhere that cannot help.
 */
export function blockFixRoute(
  reason: ReservationBlockReason,
  golfCourseId: string,
): string | null {
  switch (reason) {
    case 'missingInventory':
    case 'missingResource':
      return courseSetupRoute(golfCourseId)
    case 'full':
    case 'stopped':
    case 'notSellable':
      return null
  }
}

export function reservationBlockReason(
  target: ReservationTarget,
): ReservationBlockReason | null {
  const { column, slot } = target

  // An explicit stop is the most useful explanation, even if the row also
  // lacks generated inventory. Reopening it may reveal another setup issue,
  // but the deliberate stop is why the desk cannot book it now.
  if (!slot.isActive || slot.mark?.kind === 'closed') return 'stopped'
  if (!column.resourceId) return 'missingResource'
  if (
    column.gridSource !== 'inventory'
    || slot.capacity == null
    || slot.availableGroups == null
  ) {
    return 'missingInventory'
  }
  if (slot.availableGroups <= 0) return 'full'
  if (!slot.isSellable) return 'notSellable'
  return null
}
