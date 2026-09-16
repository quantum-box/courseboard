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
  /** Whether an invoice can be raised against this row at all. */
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
 * One customer's share of a bulk collection.
 *
 * Grouped by person rather than by booking because that is what an invoice is:
 * somebody who cancelled twice in a month gets one bill for both, not two
 * bills they have to reconcile themselves.
 */
export type CustomerFeeGroup = {
  customerId: string
  customerName: string
  customerEmail?: string
  customerPhone?: string
  rows: ReservationCancellation[]
  /** Rounds given up across the grouped bookings. */
  players: number
  amount: number
}

/** A booking that is real but is being left out of this batch, and why. */
export type UnbillableRow = {
  row: ReservationCancellation
  /**
   * `unlinked` — nobody in the ledger to raise an invoice against.
   * `already_invoiced` — Field already holds a cancellation-fee invoice for
   * this booking. CourseBoard's own row says otherwise, which means the
   * invoice went out and the write back failed; billing it again would be the
   * double charge this whole path exists to prevent.
   */
  reason: 'unlinked' | 'already_invoiced'
}

export type FeeBillingPlan = {
  groups: CustomerFeeGroup[]
  /** Selected rows no invoice can be raised for. Reported, never dropped. */
  unbillable: UnbillableRow[]
  total: number
}

/**
 * What a bulk collection would actually send.
 *
 * Built before anything is posted so the sheet can show the desk the bill it
 * is about to raise — how many people, how much each, and which selected rows
 * will be left behind because nobody linked them to the ledger.
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
): FeeBillingPlan {
  const groups = new Map<string, CustomerFeeGroup>()
  const unbillable: UnbillableRow[] = []

  for (const row of rows) {
    // Checked before the ledger link, because it is the more surprising of the
    // two: the desk selected this row precisely because our own record says
    // nobody has billed it.
    if (alreadyInvoiced.has(row.reservationId)) {
      unbillable.push({ row, reason: 'already_invoiced' })
      continue
    }
    const customerId = row.customerId?.trim()
    if (!customerId) {
      unbillable.push({ row, reason: 'unlinked' })
      continue
    }
    // A booking with no headcount is still one person who did not turn up;
    // charging it as zero would quietly bill nothing at all.
    const players = Math.max(1, row.players)
    const existing = groups.get(customerId)
    if (existing) {
      existing.rows.push(row)
      existing.players += players
      existing.amount += players * perPlayerAmount
      existing.customerEmail = existing.customerEmail ?? row.customerEmail ?? undefined
      existing.customerPhone = existing.customerPhone ?? row.customerPhone ?? undefined
      continue
    }
    groups.set(customerId, {
      customerId,
      customerName: row.customerName?.trim() || customerId,
      customerEmail: row.customerEmail ?? undefined,
      customerPhone: row.customerPhone ?? undefined,
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
