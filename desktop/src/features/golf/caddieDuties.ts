/**
 * Non-round work: which hours of the day a caddie is on it, and which of them
 * are still free.
 *
 * A caddie confirmed to work whose day the tee sheet never fills is idle on
 * the board and busy in the yard, and until now nothing on the dispatch screen
 * said which. Work is filed against a stretch of the day, so somebody on the
 * range until noon still walks the afternoon groups — the counts here read the
 * day in halves, because that is what a round is sold as.
 *
 * Kept free of React so the questions the panel asks can be tested directly.
 */

import { holdsTheRound, type CoverageAssignment } from './caddieRoundCoverage'

/** Local noon, the line half-days and duty windows are read against. */
export const MIDDAY_MINUTES = 12 * 60
export const MINUTES_IN_DAY = 24 * 60

/** One caddie put on other work for one stretch of one day, as the API returns it. */
export type CaddieDutyAssignment = {
  id: string
  caddieProfileId: string
  date: string
  dutyLabel: string
  /** `HH:MM` in the club's own clock. `00:00`–`24:00` is the whole day. */
  startTime: string
  endTime: string
  allDay: boolean
  note?: string | null
  updatedBy?: string | null
}

/** The parts of a confirmed shift this module reads. */
export type DutyShift = {
  caddieProfileId: string
  date: string
  isWorking: boolean
}

/** The parts of a caddie profile this module reads. */
export type DutyProfile = {
  id: string
  displayName: string
  employmentStatus: string
}

/** The parts of a round assignment this module reads. */
export type DutyRoundAssignment = CoverageAssignment & {
  caddieProfileId: string
  /** Offset-bearing, as the board holds it: `2026-08-29T07:00:00+09:00`. */
  scheduledAt: string
}

/** A caddie the sheet can put on other work, and what they have left. */
export type DutyCandidate = {
  caddieProfileId: string
  displayName: string
  /** `true` when nothing is filed against that half and no round runs in it. */
  morningFree: boolean
  afternoonFree: boolean
}

/** `09:00` → `540`. Anything unreadable counts as the start of the day. */
export function minutesOfClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

/** `2026-08-29T07:00:00+09:00` → `420`, read off the club's own clock. */
export function minutesOfTeeTime(scheduledAt: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(scheduledAt)
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

/** `540` → `09:00`, for a row the desk reads at a glance. */
export function clockOfMinutes(minutes: number): string {
  const bounded = Math.max(0, Math.min(MINUTES_IN_DAY, Math.round(minutes)))
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`
}

/** How long a round holds its caddie when nothing says otherwise. */
export const ROUND_MINUTES = 270

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end
}

/** Only somebody still taking rounds can be sent to do something else. */
function isOnTheRoster(profile: DutyProfile): boolean {
  return profile.employmentStatus.trim().toLowerCase() === 'active'
}

/** The stretches one caddie is spoken for that day: filed work and live rounds. */
function busyStretches({
  caddieProfileId,
  assignments,
  duties,
  date,
}: {
  caddieProfileId: string
  assignments: DutyRoundAssignment[]
  duties: CaddieDutyAssignment[]
  date: string
}): Array<[number, number]> {
  const fromDuties = duties
    .filter(duty => duty.date === date && duty.caddieProfileId === caddieProfileId)
    .map(duty => [minutesOfClock(duty.startTime), minutesOfClock(duty.endTime)] as [number, number])
  const fromRounds = assignments
    .filter(holdsTheRound)
    .filter(assignment => assignment.caddieProfileId === caddieProfileId)
    .map(assignment => {
      const start = minutesOfTeeTime(assignment.scheduledAt)
      return [start, Math.min(MINUTES_IN_DAY, start + ROUND_MINUTES)] as [number, number]
    })
  return [...fromDuties, ...fromRounds]
}

/**
 * The caddies working today with a half of the day still free.
 *
 * A day the month was never confirmed for leaves `shifts` empty, and the whole
 * active roster is then offered: before the month is planned nothing says who
 * is in, and hiding everybody would leave the desk with an empty panel on
 * exactly the days they are staffing by hand.
 *
 * Halves rather than minutes, because that is how the day is sold — a caddie
 * whose morning is spoken for is offered for the afternoon, and somebody with
 * both halves taken is not offered at all.
 */
export function caddiesWithFreeHours({
  profiles,
  assignments,
  shifts,
  duties,
  date,
}: {
  profiles: DutyProfile[]
  assignments: DutyRoundAssignment[]
  shifts: DutyShift[]
  duties: CaddieDutyAssignment[]
  date: string
}): DutyCandidate[] {
  const dayShifts = shifts.filter(shift => shift.date === date)
  const confirmed = new Map(dayShifts.map(shift => [shift.caddieProfileId, shift.isWorking]))

  return profiles
    .filter(isOnTheRoster)
    .filter(profile => confirmed.get(profile.id) ?? dayShifts.length === 0)
    .map(profile => {
      const busy = busyStretches({
        caddieProfileId: profile.id,
        assignments,
        duties,
        date,
      })
      return {
        caddieProfileId: profile.id,
        displayName: profile.displayName,
        morningFree: !busy.some(([start, end]) => overlaps(start, end, 0, MIDDAY_MINUTES)),
        afternoonFree: !busy.some(([start, end]) =>
          overlaps(start, end, MIDDAY_MINUTES, MINUTES_IN_DAY),
        ),
      }
    })
    .filter(candidate => candidate.morningFree || candidate.afternoonFree)
}

/** One filed job, ready to draw. */
export type FiledDuty = {
  duty: CaddieDutyAssignment
  displayName: string
}

/**
 * The jobs filed for the day, earliest first.
 *
 * A job filed against a caddie who has since left the roster still appears,
 * named by their id: the row is how the desk clears it, and dropping it would
 * leave the hours quietly counted against nothing.
 */
export function filedDuties({
  profiles,
  duties,
  date,
}: {
  profiles: DutyProfile[]
  duties: CaddieDutyAssignment[]
  date: string
}): FiledDuty[] {
  const named = new Map(profiles.map(profile => [profile.id, profile.displayName]))
  return duties
    .filter(duty => duty.date === date)
    .slice()
    .sort((left, right) => {
      const byStart = minutesOfClock(left.startTime) - minutesOfClock(right.startTime)
      if (byStart !== 0) return byStart
      return left.caddieProfileId.localeCompare(right.caddieProfileId)
    })
    .map(duty => ({
      duty,
      displayName: named.get(duty.caddieProfileId) ?? duty.caddieProfileId,
    }))
}

/** What the API would refuse about a window, checked before the round trip. */
export type DutyWindowProblem = 'order' | 'range' | 'clash' | null

/**
 * Whether these hours can be filed for this caddie.
 *
 * `clash` covers both a job already on those hours and a round the caddie is
 * out on — the desk reads the same thing either way: those hours are spoken
 * for.
 */
export function dutyWindowProblem({
  startTime,
  endTime,
  caddieProfileId,
  assignments,
  duties,
  date,
}: {
  startTime: string
  endTime: string
  caddieProfileId: string
  assignments: DutyRoundAssignment[]
  duties: CaddieDutyAssignment[]
  date: string
}): DutyWindowProblem {
  const start = minutesOfClock(startTime)
  const end = minutesOfClock(endTime)
  if (start < 0 || end > MINUTES_IN_DAY) return 'range'
  if (end <= start) return 'order'
  const busy = busyStretches({ caddieProfileId, assignments, duties, date })
  return busy.some(([from, to]) => overlaps(start, end, from, to)) ? 'clash' : null
}

/** More jobs than this stops being a pick list. Matches the API. */
export const MAX_CADDIE_DUTIES = 30
/** Matches the column width; a longer label is an instruction, not a job name. */
export const MAX_CADDIE_DUTY_LENGTH = 40

export type CaddieDutyValidation = 'tooMany' | 'tooLong' | 'duplicate' | null

/** Blank rows are dropped, as the form grows rows the operator may leave empty. */
export function normalizedCaddieDuties(values: string[]): string[] {
  return values.map(value => value.trim()).filter(value => value !== '')
}

/**
 * What the API would refuse, checked before the round trip so the operator
 * reads it next to the row they typed.
 */
export function validateCaddieDuties(values: string[]): CaddieDutyValidation {
  const options = normalizedCaddieDuties(values)
  if (options.length > MAX_CADDIE_DUTIES) return 'tooMany'
  if (options.some(option => [...option].length > MAX_CADDIE_DUTY_LENGTH)) return 'tooLong'
  if (new Set(options).size !== options.length) return 'duplicate'
  return null
}
