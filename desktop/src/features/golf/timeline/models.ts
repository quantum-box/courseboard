export type PlayType = 'caddie' | 'self'

export type TeeReservationStatus =
  | 'confirmed'
  | 'checked_in'
  | 'on_course'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type AssignmentCoverage = 'assigned' | 'partial' | 'unassigned' | 'not_required'

export type TeeReservation = {
  id: string
  reservationNumber: string
  reservationServiceId?: string | null
  displayName?: string | null
  golfCourseId: string
  courseName: string
  teeTime: string
  durationMinutes: number
  playType: PlayType
  partySize: number
  partyName: string
  status: TeeReservationStatus
  holes: number
  notes?: string | null
}

export type TimelineAssignment = {
  id: string
  caddieProfileId: string
  reservationId?: string | null
  roundReference?: string | null
  scheduledAt: string
  /** Present in mock / enriched responses; real Field API may omit this. */
  durationMinutes?: number
  status: string
  assignmentRole: string
  feeAmount: number
  feeCurrency: string
}

export type TimelineCaddie = {
  id: string
  displayName: string
  skillLevel: string
  rank: string
  employmentStatus: string
  maxRoundsPerDay: number
  canTwoRounds: boolean
}

export type TeeSheetResponse = {
  date: string
  timezone: string
  dayStart: string
  dayEnd: string
  items: TeeReservation[]
}

export type TimelineBlock = {
  id: string
  startMinutes: number
  endMinutes: number
  leftPct: number
  widthPct: number
}

export type TimelineWindow = {
  startMinutes: number
  endMinutes: number
}
