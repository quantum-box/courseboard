/**
 * Cancelled bookings, read back by period rather than by booking.
 *
 * A cancelled tee time leaves the board — that is what cancelling means — so
 * until now the club had no way to look at a month of them, and no way at all
 * to see why. The reason is CourseBoard's own record (Field keeps only the
 * fact and the moment), and it is what the whole screen is sorted and counted
 * by: "who cancels on the day, every time" is a different question from "how
 * many did the weather take", and only one of them ends in an invoice.
 */

import type { Customer } from './models'

/** The club's own reasons, in the order the screen offers them. */
export const CANCELLATION_REASONS = [
  'weather',
  'illness',
  'personal',
  'no_contact',
  'course_side',
  'shortage',
  'mistake',
  'other',
] as const

export type CancellationReason = (typeof CANCELLATION_REASONS)[number]

/** Where the fee got to. Not a payment state — that stays on the invoice. */
export type CancellationFeeState = 'unsettled' | 'waived' | 'invoiced'

export const CANCELLATION_FEE_STATES: CancellationFeeState[] = [
  'unsettled',
  'invoiced',
  'waived',
]

export type ReservationCancellation = {
  reservationId: string
  reservationNumber?: string | null
  /** Absent when the booking was never linked to the ledger. */
  customerId?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  /**
   * Whether the booking carries a ledger link. Not whether it can be billed:
   * a booking taken under a name alone is invoiced as an unregistered
   * recipient (PLT-4159).
   */
  billable: boolean
  golfCourseId?: string | null
  teeTime?: string | null
  playedOn?: string | null
  players: number
  bookingAmount?: number | null
  currency?: string | null
  reason: CancellationReason | string
  reasonNote?: string | null
  /** Whether the club would normally charge for a cancellation of this kind. */
  feeExpected: boolean
  /** Whole days of notice; negative once the tee time has gone. */
  noticeDays?: number | null
  feeState: CancellationFeeState | string
  feeInvoiceId?: string | null
  feeAmount?: number | null
  feeSettledAt?: string | null
  feeNote?: string | null
  cancelledAt: string
  cancelledBy?: string | null
}

export type ReservationCancellationPage = {
  items: ReservationCancellation[]
  /** How many rows the filters select, not how many came back. */
  total: number
}

export const cancellationsPath = '/v1/course/reservation-cancellations'

/** Rows a page asks the server for. Same as the other rosters. */
export const CANCELLATION_PAGE_SIZE = 20

/**
 * The orders the server can put a whole period in. The name is not one: the
 * name on screen is the ledger's, looked up for the page being shown.
 */
export type CancellationSort =
  | 'played_on'
  | 'reason'
  | 'notice_days'
  | 'players'
  | 'booking_amount'
  | 'fee_state'

export type CancellationOrder = { sort: CancellationSort; ascending: boolean }

/** Latest day of play first: the order a desk works a period in. */
export const DEFAULT_CANCELLATION_ORDER: CancellationOrder = {
  sort: 'played_on',
  ascending: false,
}

/** The table column each server order is drawn in. */
export const CANCELLATION_SORT_COLUMNS: Record<CancellationSort, string> = {
  played_on: 'playedOn',
  reason: 'reason',
  notice_days: 'notice',
  players: 'players',
  booking_amount: 'bookingAmount',
  fee_state: 'feeState',
}

export function cancellationSortForColumn(key: string): CancellationSort | null {
  const entry = Object.entries(CANCELLATION_SORT_COLUMNS).find(([, column]) => column === key)
  return entry ? (entry[0] as CancellationSort) : null
}

/** What the desk is asking for. Every field narrows. */
export type CancellationFilters = {
  from: string
  to: string
  /** Empty means every reason. */
  reason: CancellationReason | ''
  /** Empty means every state. */
  feeState: CancellationFeeState | ''
  /** Keep only the reasons the club charges for. */
  chargeableOnly: boolean
}

/**
 * The list the desk opens on: the last month, the reasons the club charges
 * for, and only what nobody has settled. That is the collection list — anything
 * wider is a question about the month rather than a morning's work, and the
 * filters are right there to widen it.
 */
export function defaultCancellationFilters(today: string): CancellationFilters {
  return {
    from: addDays(today, -30),
    to: today,
    reason: '',
    feeState: 'unsettled',
    chargeableOnly: true,
  }
}

/** Calendar arithmetic on a `YYYY-MM-DD`, without dragging in a timezone. */
export function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function cancellationsQuery(
  filters: CancellationFilters,
  order: CancellationOrder = DEFAULT_CANCELLATION_ORDER,
  page = 0,
) {
  const params = new URLSearchParams()
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.reason) params.set('reasons', filters.reason)
  if (filters.feeState) params.set('feeStates', filters.feeState)
  // Asking for one reason is more specific than "the chargeable ones", so the
  // two are not both sent: a weather row selected by name should come back.
  if (filters.chargeableOnly && !filters.reason) params.set('feeExpectedOnly', 'true')
  if (order.sort !== DEFAULT_CANCELLATION_ORDER.sort) params.set('sort', order.sort)
  // Descending is the upstream default, so only the other way round is said.
  if (order.ascending) params.set('ascending', 'true')
  params.set('limit', String(CANCELLATION_PAGE_SIZE))
  if (page > 0) params.set('offset', String(page * CANCELLATION_PAGE_SIZE))
  return `${cancellationsPath}?${params.toString()}`
}

/**
 * Who one invoice in a bulk collection is addressed to.
 *
 * A booking the ledger knows is billed as that customer. A booking taken under
 * a name nobody ever linked is billed by the name itself, which Field keeps as
 * an immutable snapshot (PLT-4159) — the club has no identifier for somebody
 * who rang once and gave up a tee time, and a cancellation nobody can invoice
 * is money nobody chases.
 */
export type FeeRecipient =
  | { kind: 'customer'; customerId: string }
  | { kind: 'unregistered'; name: string; phone?: string }

/**
 * One recipient's share of a bulk collection.
 *
 * Grouped by person rather than by booking because that is what an invoice is:
 * somebody who cancelled twice in a month gets one bill for both, not two
 * bills they have to reconcile themselves. Two bookings under the same *typed*
 * name are not evidence of one person, though, so an unlinked booking is its
 * own group — see `feeGroupKey`.
 */
export type CustomerFeeGroup = {
  /** What the rows were grouped by. Stable, and not for display. */
  key: string
  recipient: FeeRecipient
  customerName: string
  customerEmail?: string
  customerPhone?: string
  rows: ReservationCancellation[]
  /** Rounds given up across the grouped bookings. */
  players: number
  amount: number
}

/**
 * What the desk decided about a booking the ledger has no link for.
 *
 * Supplied by the collection sheet, per booking, so a row that used to be
 * dropped for want of a customer id can be billed: either against the ledger
 * entry the desk recognised, or by the name as typed.
 */
export type CancellationFeeAssignment = {
  /** The ledger entry the desk picked, if it recognised one. */
  customer: Customer | null
  /** Who the invoice goes out to when no ledger entry was picked. */
  name: string
  /** E.164, or empty. The caller normalises; an unreadable number never gets here. */
  phone?: string
}

/** A booking that is real but is being left out of this batch, and why. */
export type UnbillableRow = {
  row: ReservationCancellation
  /**
   * `unnamed` — no ledger link and no name to address an invoice to, so there
   * is nothing to put on one. The sheet offers a name box for exactly these.
   * `already_invoiced` — Field already holds a cancellation-fee invoice for
   * this booking. CourseBoard's own row says otherwise, which means the
   * invoice went out and the write back failed; billing it again would be the
   * double charge this whole path exists to prevent.
   */
  reason: 'unnamed' | 'already_invoiced'
}

export type FeeBillingPlan = {
  groups: CustomerFeeGroup[]
  /** Selected rows no invoice can be raised for. Reported, never dropped. */
  unbillable: UnbillableRow[]
  total: number
}

/**
 * What the rows of one invoice are collected under.
 *
 * A customer id groups every booking that person gave up. A booking with no
 * ledger link groups only itself: the typed name is all there is to go on, and
 * merging two of them would put one guest's fee on another guest's invoice.
 */
function feeGroupKey(recipient: FeeRecipient, row: ReservationCancellation): string {
  return recipient.kind === 'customer'
    ? `customer:${recipient.customerId}`
    : `reservation:${row.reservationId}`
}

/**
 * What a bulk collection would actually send.
 *
 * Built before anything is posted so the sheet can show the desk the bill it
 * is about to raise — how many people, how much each, and which selected rows
 * are still short of a name to address.
 */
export function planCancellationFees(
  rows: ReservationCancellation[],
  perPlayerAmount: number,
  /**
   * Bookings Field already has a cancellation-fee invoice for. Empty when the
   * lookup could not be made, which leaves the batch exactly as it was before
   * the guard existed rather than blocking it.
   */
  alreadyInvoiced: ReadonlySet<string> = new Set(),
  /** What the desk filled in for the bookings with no ledger link. */
  assignments: ReadonlyMap<string, CancellationFeeAssignment> = new Map(),
): FeeBillingPlan {
  const groups = new Map<string, CustomerFeeGroup>()
  const unbillable: UnbillableRow[] = []

  for (const row of rows) {
    // Checked first, because it is the most surprising of the outcomes: the
    // desk selected this row precisely because our own record says nobody has
    // billed it.
    if (alreadyInvoiced.has(row.reservationId)) {
      unbillable.push({ row, reason: 'already_invoiced' })
      continue
    }
    const assignment = assignments.get(row.reservationId)
    const recipient = feeRecipient(row, assignment)
    if (!recipient) {
      unbillable.push({ row, reason: 'unnamed' })
      continue
    }
    // A booking with no headcount is still one person who did not turn up;
    // charging it as zero would quietly bill nothing at all.
    const players = Math.max(1, row.players)
    const key = feeGroupKey(recipient, row)
    const email = row.customerEmail?.trim() || assignment?.customer?.email?.trim() || undefined
    const phone = recipient.kind === 'unregistered'
      ? recipient.phone
      : row.customerPhone?.trim() || assignment?.customer?.phone?.trim() || undefined
    const existing = groups.get(key)
    if (existing) {
      existing.rows.push(row)
      existing.players += players
      existing.amount += players * perPlayerAmount
      existing.customerEmail = existing.customerEmail ?? email
      existing.customerPhone = existing.customerPhone ?? phone
      continue
    }
    groups.set(key, {
      key,
      recipient,
      customerName: recipientName(row, recipient, assignment),
      customerEmail: email,
      customerPhone: phone,
      rows: [row],
      players,
      amount: players * perPlayerAmount,
    })
  }

  const ordered = [...groups.values()]
  return {
    groups: ordered,
    unbillable,
    total: ordered.reduce((sum, group) => sum + group.amount, 0),
  }
}

/**
 * Who this booking's fee is owed by, or nothing if that cannot be said yet.
 *
 * The booking's own ledger link comes first: it is the club's record of who
 * played, and the desk's entry in the sheet is there to answer the rows that
 * have none.
 */
function feeRecipient(
  row: ReservationCancellation,
  assignment: CancellationFeeAssignment | undefined,
): FeeRecipient | null {
  const customerId = row.customerId?.trim() || assignment?.customer?.id.trim()
  if (customerId) return { kind: 'customer', customerId }
  // The sheet's entry wins where there is one: the desk may have corrected the
  // name the booking was taken under, or cleared a number it should not keep.
  const name = (assignment ? assignment.name : row.customerName ?? '').trim()
  if (!name) return null
  const phone = (assignment ? assignment.phone ?? '' : row.customerPhone ?? '').trim()
  return { kind: 'unregistered', name, ...(phone ? { phone } : {}) }
}

/** The name on the invoice, and on the line of the sheet that previews it. */
function recipientName(
  row: ReservationCancellation,
  recipient: FeeRecipient,
  assignment: CancellationFeeAssignment | undefined,
): string {
  if (recipient.kind === 'unregistered') return recipient.name
  return row.customerName?.trim()
    || assignment?.customer?.name.trim()
    || recipient.customerId
}

/**
 * How one invoice's total is attributed back to the bookings it covers.
 *
 * Split by rounds given up rather than evenly, because that is how the amount
 * was worked out in the first place: a four-ball and a two-ball on one invoice
 * did not cost the same. The remainder from the division goes on the first
 * booking, so the parts always add back up to the invoice — a set of rows that
 * sums to a different number than the bill is the kind of discrepancy nobody
 * finds until an auditor does.
 */
export function splitFeeAcrossRows(
  group: CustomerFeeGroup,
): { reservationId: string; amount: number }[] {
  const players = group.rows.map(row => Math.max(1, row.players))
  const total = players.reduce((sum, count) => sum + count, 0)
  const shares = players.map(count => Math.floor((group.amount * count) / total))
  const remainder = group.amount - shares.reduce((sum, share) => sum + share, 0)
  return group.rows.map((row, index) => ({
    reservationId: row.reservationId,
    amount: (shares[index] ?? 0) + (index === 0 ? remainder : 0),
  }))
}
