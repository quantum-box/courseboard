import type { TeeReservation } from '../timeline/models'

/** Where a column's rows came from. Only `inventory` counts remaining groups. */
export type SlotGridSource = 'inventory' | 'schedule' | 'opening_hours' | 'bookings_only'

export type SlotMarkKind = 'closed' | 'special_rate'

export type SlotMark = {
  golfCourseId: string
  date: string
  teeTime: string
  kind: SlotMarkKind
  label?: string | null
  note?: string | null
}

export type LedgerSlot = {
  /** Local wall clock `HH:MM`. */
  teeTime: string
  /** Groups the course may start here. Absent means nobody counted — not zero. */
  capacity?: number | null
  availableGroups?: number | null
  bookedGroups: number
  playerCount: number
  isActive: boolean
  isSellable: boolean
  mark?: SlotMark | null
  items: TeeReservation[]
}

export type LedgerColumn = {
  golfCourseId: string
  courseName: string
  resourceId?: string | null
  startIntervalMinutes?: number | null
  gridSource: SlotGridSource
  groupCount: number
  playerCount: number
  selfGroupCount: number
  caddieGroupCount: number
  openSlotCount: number
  slots: LedgerSlot[]
}

export type TeeLedgerResponse = {
  date: string
  timezone: string
  columns: LedgerColumn[]
  /** Lookups that failed; the board is drawn but some detail is a fallback. */
  unavailable?: string[]
}

export type PartyPlayer = {
  name: string
  /** Booking channel or rate class shown above the name (`共通`, `優待`, …). */
  tag?: string | null
  memberNumber?: string | null
  /**
   * Who this player is in the customer ledger, once the desk has said so.
   *
   * Absent on every group entered before the ledger existed and on anyone the
   * desk has not identified yet, so treat it as optional rather than as a field
   * that fills itself in.
   */
  customerId?: string | null
}

export type PartySettlement = 'individual' | 'together'

/** The `【食】/【集計】/【精算】` lines of a start ledger. */
export type PartyRemarks = {
  /** What the group does about lunch (`各自注文`, …). */
  meal?: string | null
  /** Whether the course tallies the competition's scores. */
  scoreTally?: boolean | null
  /** Each player pays, or one person pays for the group. */
  settlement?: PartySettlement | string | null
}

export type PartyDetails = {
  competitionName?: string | null
  organizer?: string | null
  groupNumber?: number | null
  players: PartyPlayer[]
  /** Absent on groups nobody has written remarks for. */
  remarks?: PartyRemarks | null
}
