import { COURSE_TIME_ZONE } from '../../lib/clock'

import { i18next } from '../../i18n'

export type GolfCourse = {
  id: string
  name: string
  shortName?: string | null
  holeCount: number
  timezone: string
  businessHoursJson?: { open: string; close: string } | null
  startIntervalMinutes: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type GolfCourseDraft = {
  name: string
  shortName: string
  holeCount: number
  timezone: string
  startIntervalMinutes: number
  isActive: boolean
}

export type ExtensionStatus = {
  extensionKey: string
  name: string
  tenantStatus?: 'enabled' | 'disabled' | null
  configVersion?: number | null
  configJson?: Record<string, unknown> | null
  validation?: {
    valid: boolean
    errors: string[]
  }
  updatedAt?: string | null
}

export type PlayType = 'caddie' | 'self'

export type GolfReservationProduct = {
  id: string
  tenantId: string
  extensionKey: string
  reservationServiceId: string
  displayName?: string | null
  playType: PlayType
  holeCount: number
  expectedDurationMinutes: number
  /** Course this plan is sold on; absent on plans written before courses split. */
  golfCourseId?: string | null
  createdAt: string
  updatedAt: string
}

export type GolfReservationProductDraft = {
  serviceId: string
  displayName: string
  playType: PlayType
  holeCount: number
  expectedDurationMinutes: number
  /** Empty string means "not tied to a course yet". */
  golfCourseId: string
}

export type GolfProductSlot = {
  id?: string
  golfReservationProductId?: string
  weekday: number
  startTime: string
  endTime: string
  maxGroups: number
  maxPlayers: number
}

export type CapacityProfile = {
  id: string
  active?: boolean
  canTwoRounds?: boolean
}

export type CapacityAvailability = {
  caddieProfileId: string
  status:
    | 'available'
    | 'unavailable'
    | 'morning_only'
    | 'afternoon_only'
    | 'light_duty'
  twoRoundRequest?: boolean
}

export type CaddieSlotCapacity = {
  morningCapacity: number
  afternoonCapacity: number
  totalRounds: number
  activeCaddies: number
  unavailable: number
  assumedAvailable: number
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** `weekday` is the JS day index (0 = Sunday); captions follow the active locale. */
export function weekdayLabel(weekday: number) {
  const key = WEEKDAY_KEYS[weekday] ?? 'sun'
  return i18next.t(`common:weekday.${key}` as 'common:weekday.sun')
}

export const weekdayIndexes = WEEKDAY_KEYS.map((_, index) => index)

export function emptyCourseDraft(): GolfCourseDraft {
  return {
    name: '',
    shortName: '',
    holeCount: 18,
    timezone: COURSE_TIME_ZONE,
    startIntervalMinutes: 10,
    isActive: true,
  }
}

export function courseToDraft(course: GolfCourse): GolfCourseDraft {
  return {
    name: course.name,
    shortName: course.shortName ?? '',
    holeCount: course.holeCount,
    timezone: course.timezone,
    startIntervalMinutes: course.startIntervalMinutes,
    isActive: course.isActive,
  }
}

export function defaultDuration(playType: PlayType, holeCount: number) {
  if (playType === 'caddie') return holeCount === 18 ? 240 : 150
  return holeCount === 18 ? 180 : 120
}

export function emptyProductDraft(): GolfReservationProductDraft {
  return {
    serviceId: '',
    displayName: '',
    playType: 'caddie',
    holeCount: 18,
    expectedDurationMinutes: defaultDuration('caddie', 18),
    golfCourseId: '',
  }
}

export function productToDraft(product: GolfReservationProduct): GolfReservationProductDraft {
  return {
    serviceId: product.reservationServiceId,
    displayName: product.displayName ?? '',
    playType: product.playType,
    holeCount: product.holeCount,
    expectedDurationMinutes: product.expectedDurationMinutes,
    golfCourseId: product.golfCourseId ?? '',
  }
}

export function emptySlot(weekday = 1): GolfProductSlot {
  return {
    weekday,
    startTime: '07:00',
    endTime: '12:00',
    maxGroups: 0,
    maxPlayers: 0,
  }
}

export function normalizeSlot(slot: GolfProductSlot): GolfProductSlot {
  return {
    ...slot,
    startTime: slot.startTime.slice(0, 5),
    endTime: slot.endTime.slice(0, 5),
  }
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/**
 * Why the operator cannot save this plan yet, or `null` when it is fine.
 *
 * The save button stays enabled on purpose: telling the operator which field
 * is wrong beats a button that is dead for a reason they have to guess.
 *
 * `requireCourse` is on for new plans only. Courses arrived after the plans
 * did, so demanding one from every edit would lock a tenant out of the plans
 * they already have; demanding it from every *new* plan still empties the
 * backlog, one plan at a time.
 */
export function validateProduct(
  draft: GolfReservationProductDraft,
  { requireCourse = false }: { requireCourse?: boolean } = {},
) {
  if (!draft.displayName.trim()) return i18next.t('products:validation.displayNameRequired')
  if ([...draft.displayName.trim()].length > 255) {
    return i18next.t('products:validation.displayNameLength')
  }
  if (!draft.serviceId.trim()) return i18next.t('products:validation.serviceIdRequired')
  if (!/^[A-Za-z0-9._:-]+$/.test(draft.serviceId.trim())) {
    return i18next.t('products:validation.serviceIdFormat')
  }
  if (requireCourse && !draft.golfCourseId.trim()) {
    return i18next.t('products:validation.courseRequired')
  }
  if (![9, 18].includes(draft.holeCount)) return i18next.t('products:validation.holeCount')
  if (
    !Number.isInteger(draft.expectedDurationMinutes)
    || draft.expectedDurationMinutes < 30
    || draft.expectedDurationMinutes > 720
  ) {
    return i18next.t('products:validation.duration')
  }
  return null
}

export type SlotIssueCode =
  | 'weekday'
  | 'time'
  | 'order'
  | 'maxGroups'
  | 'maxPlayers'
  | 'duplicate'

function slotBandKey(slot: GolfProductSlot) {
  return `${slot.weekday}|${slot.startTime}|${slot.endTime}`
}

/**
 * What is wrong with each row, index-aligned with `slots`.
 *
 * Codes rather than sentences, and per row rather than per week: the editor
 * prints them next to the offending row. The block of "3行目: …" lines this
 * replaced named an array position, which stopped meaning anything once the
 * week was drawn as seven weekday cards.
 */
export function collectSlotIssues(slots: GolfProductSlot[]): SlotIssueCode[][] {
  const seen = new Set<string>()

  return slots.map(slot => {
    const codes: SlotIssueCode[] = []
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6) {
      codes.push('weekday')
    }
    if (!validTime(slot.startTime) || !validTime(slot.endTime)) {
      codes.push('time')
    } else if (slot.startTime >= slot.endTime) {
      codes.push('order')
    }
    if (!Number.isInteger(slot.maxGroups) || slot.maxGroups < 0) {
      codes.push('maxGroups')
    }
    if (!Number.isInteger(slot.maxPlayers) || slot.maxPlayers < 0) {
      codes.push('maxPlayers')
    }

    const key = slotBandKey(slot)
    if (seen.has(key)) codes.push('duplicate')
    seen.add(key)

    return codes
  })
}

/** The row-agnostic wording the editor shows underneath the offending row. */
export function slotIssueText(code: SlotIssueCode) {
  return i18next.t(`products:slotIssue.${code}` as 'products:slotIssue.time')
}

/** How many rows the operator has to fix before the week can be saved. */
export function countSlotIssues(slots: GolfProductSlot[]) {
  return collectSlotIssues(slots).filter(codes => codes.length > 0).length
}

function minutesOfDay(time: string) {
  if (!validTime(time)) return null
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

/**
 * How many groups the course can physically start inside a band.
 *
 * Tee times go out one interval apart, so a band is worth
 * `(length / interval) + 1` starts — counting the one that leaves on the
 * closing minute. Generous on purpose: this drives a warning, and a warning
 * that fires on a plan that is actually fine teaches operators to ignore it.
 *
 * `null` when the course, its interval, or the band is unusable.
 */
export function bandGroupCapacity(
  startTime: string,
  endTime: string,
  startIntervalMinutes: number | null | undefined,
) {
  if (!startIntervalMinutes || startIntervalMinutes <= 0) return null
  const start = minutesOfDay(startTime)
  const end = minutesOfDay(endTime)
  if (start === null || end === null || end <= start) return null
  return Math.floor((end - start) / startIntervalMinutes) + 1
}

/**
 * Bands that promise more groups than the course can start, index-aligned with
 * `slots`. `0` groups means "no limit", which nothing can contradict.
 */
export function collectSlotOvercommits(
  slots: GolfProductSlot[],
  startIntervalMinutes: number | null | undefined,
): (number | null)[] {
  return slots.map(slot => {
    if (slot.maxGroups <= 0) return null
    const capacity = bandGroupCapacity(slot.startTime, slot.endTime, startIntervalMinutes)
    if (capacity === null || slot.maxGroups <= capacity) return null
    return capacity
  })
}

/** Weekday, then time of day: the order an operator reads a week in. */
export function sortSlots<T extends GolfProductSlot>(slots: T[]): T[] {
  return [...slots].sort((left, right) => (
    left.weekday - right.weekday
    || left.startTime.localeCompare(right.startTime)
    || left.endTime.localeCompare(right.endTime)
  ))
}

export type SlotChangeSummary = {
  added: number
  removed: number
  changed: number
}

export function slotChangeCount(summary: SlotChangeSummary) {
  return summary.added + summary.removed + summary.changed
}

/**
 * What saving would do to the stored week.
 *
 * Saving is a whole-week replace, so a row the operator deleted is gone for
 * good the moment they press save. Counting the removals up front is what lets
 * the editor say so before that happens, instead of after.
 *
 * Rows are matched on weekday and time band — the band is what a booking screen
 * offers, so a row that keeps its band but drops its limits reads as changed,
 * and one that moves to another time reads as a removal plus an addition.
 */
export function summarizeSlotChanges(
  baseline: GolfProductSlot[],
  current: GolfProductSlot[],
): SlotChangeSummary {
  const before = new Map(baseline.map(slot => [slotBandKey(slot), slot]))
  const after = new Map(current.map(slot => [slotBandKey(slot), slot]))

  let added = 0
  let changed = 0
  after.forEach((slot, key) => {
    const previous = before.get(key)
    if (!previous) {
      added += 1
      return
    }
    if (previous.maxGroups !== slot.maxGroups || previous.maxPlayers !== slot.maxPlayers) {
      changed += 1
    }
  })

  let removed = 0
  before.forEach((_, key) => {
    if (!after.has(key)) removed += 1
  })

  return { added, removed, changed }
}

/**
 * Put the source weekday's bands on every target weekday, replacing whatever
 * those days held. Building Monday and stamping it onto the rest of the week is
 * the bulk of setting a season up, and doing it a row at a time is where the
 * old editor lost people.
 */
export function copyWeekdaySlots(
  slots: GolfProductSlot[],
  from: number,
  targets: number[],
): GolfProductSlot[] {
  const days = targets.filter(target => target !== from)
  if (days.length === 0) return slots

  const source = slots.filter(slot => slot.weekday === from)
  const kept = slots.filter(slot => !days.includes(slot.weekday))
  const copies = days.flatMap(target => source.map(slot => ({
    weekday: target,
    startTime: slot.startTime,
    endTime: slot.endTime,
    maxGroups: slot.maxGroups,
    maxPlayers: slot.maxPlayers,
  })))

  return [...kept, ...copies]
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number)
  const total = Math.min(hour * 60 + minute + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The next band to offer on a weekday: one that starts where the day currently
 * ends, so adding a second row does not open on top of the first one.
 */
export function nextSlotForWeekday(slots: GolfProductSlot[], weekday: number): GolfProductSlot {
  const sameDay = slots.filter(slot => slot.weekday === weekday)
  if (sameDay.length === 0) return emptySlot(weekday)

  const latestEnd = sameDay.reduce(
    (latest, slot) => (slot.endTime > latest ? slot.endTime : latest),
    sameDay[0].endTime,
  )
  if (!validTime(latestEnd) || latestEnd >= '23:00') return emptySlot(weekday)

  return {
    ...emptySlot(weekday),
    startTime: latestEnd,
    endTime: addMinutes(latestEnd, 180),
  }
}

export function calculateCaddieCapacity(
  sourceProfiles: CapacityProfile[],
  availabilities: CapacityAvailability[],
): CaddieSlotCapacity {
  const profiles = sourceProfiles.filter(profile => profile.active !== false)
  const availabilityByCaddie = new Map(
    availabilities.map(availability => [availability.caddieProfileId, availability]),
  )
  let morningCapacity = 0
  let afternoonCapacity = 0
  let totalRounds = 0
  let unavailable = 0
  let assumedAvailable = 0

  profiles.forEach(profile => {
    const availability = availabilityByCaddie.get(profile.id)
    const status = availability?.status ?? 'available'
    if (!availability) assumedAvailable += 1
    if (status === 'unavailable') {
      unavailable += 1
      return
    }

    const worksMorning = status !== 'afternoon_only'
    const worksAfternoon = status !== 'morning_only'
    if (worksMorning) morningCapacity += 1
    if (worksAfternoon) afternoonCapacity += 1

    const canTakeTwoRounds = Boolean(
      profile.canTwoRounds
      && availability?.twoRoundRequest
      && status !== 'light_duty'
      && worksMorning
      && worksAfternoon,
    )
    totalRounds += canTakeTwoRounds ? 2 : 1
  })

  return {
    morningCapacity,
    afternoonCapacity,
    totalRounds,
    activeCaddies: profiles.length,
    unavailable,
    assumedAvailable,
  }
}

/** Groups another plan already accepts on one weekday, split at midday. */
export type WeekdayGroupLoad = {
  morning: number
  afternoon: number
  /**
   * A band on this weekday takes unlimited groups, so what is left over cannot
   * be counted — only reported as uncountable.
   */
  unlimited: boolean
}

/** Morning and afternoon are split at midday, the same line `applyCapacityToSlots` uses. */
export function weekdayGroupLoad(
  slots: GolfProductSlot[],
  weekday: number,
): WeekdayGroupLoad {
  return slots
    .filter(slot => slot.weekday === weekday)
    .reduce<WeekdayGroupLoad>((load, slot) => {
      if (slot.maxGroups <= 0) return { ...load, unlimited: true }
      const morning = slot.startTime < '12:00'
      return {
        ...load,
        morning: load.morning + (morning ? slot.maxGroups : 0),
        afternoon: load.afternoon + (morning ? 0 : slot.maxGroups),
      }
    }, { morning: 0, afternoon: 0, unlimited: false })
}

/**
 * The caddies left for this plan once the other plans on the same course have
 * taken theirs.
 *
 * Caddies belong to the course, not to a plan. Two caddie plans on one course
 * draw on the same people, so offering each of them the full supply books the
 * same caddie twice — the number this screen shows has to be what is left.
 *
 * An uncountable load (or none at all) returns the supply unchanged; the panel
 * says so rather than pretending the subtraction happened.
 */
export function capacityAfterLoad(
  capacity: CaddieSlotCapacity,
  load: WeekdayGroupLoad | null,
): CaddieSlotCapacity {
  if (!load || load.unlimited) return capacity
  return {
    ...capacity,
    morningCapacity: Math.max(0, capacity.morningCapacity - load.morning),
    afternoonCapacity: Math.max(0, capacity.afternoonCapacity - load.afternoon),
  }
}

export function weekdayForIsoDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function applyCapacityToSlots(
  slots: GolfProductSlot[],
  date: string,
  capacity: CaddieSlotCapacity,
) {
  const weekday = weekdayForIsoDate(date)
  const matching = slots.filter(slot => slot.weekday === weekday)
  if (matching.length === 0) {
    return [
      ...slots,
      {
        ...emptySlot(weekday),
        maxGroups: capacity.morningCapacity,
      },
      {
        ...emptySlot(weekday),
        startTime: '12:00',
        endTime: '15:00',
        maxGroups: capacity.afternoonCapacity,
      },
    ]
  }

  return slots.map(slot => (
    slot.weekday === weekday
      ? {
          ...slot,
          maxGroups: slot.startTime < '12:00'
            ? capacity.morningCapacity
            : capacity.afternoonCapacity,
        }
      : slot
  ))
}
