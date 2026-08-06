import { i18next } from '../../i18n'

export type GolfCourse = {
  id: string
  name: string
  shortName?: string | null
  holeCount: number
  /** Legacy response field; tenant extension config owns the setting. */
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
  /** Courses this plan is sold on; absent on plans written before courses split. */
  golfCourseIds?: string[] | null
  /** Compatibility alias the API sends only for a plan on exactly one course. */
  golfCourseId?: string | null
  /** Players allowed in one group; absent means the reservation policy decides. */
  maxPlayersPerGroup?: number | null
  createdAt: string
  updatedAt: string
}

export type GolfReservationProductDraft = {
  serviceId: string
  displayName: string
  playType: PlayType
  holeCount: number
  expectedDurationMinutes: number
  /** Empty means "not tied to a course yet". */
  golfCourseIds: string[]
  /** Empty string means "use the reservation policy", not "zero players". */
  maxPlayersPerGroup: string
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
    startIntervalMinutes: 10,
    isActive: true,
  }
}

export function courseToDraft(course: GolfCourse): GolfCourseDraft {
  return {
    name: course.name,
    shortName: course.shortName ?? '',
    holeCount: course.holeCount,
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
    golfCourseIds: [],
    maxPlayersPerGroup: '',
  }
}

/**
 * The courses a plan is sold on, whichever shape the API answered in.
 *
 * A plan on several courses only has the array; one written before the array
 * existed only has the scalar. Reading both here keeps every caller from
 * having to know which vintage it is looking at.
 */
export function productCourseIds(product: GolfReservationProduct): string[] {
  if (product.golfCourseIds) return product.golfCourseIds
  return product.golfCourseId ? [product.golfCourseId] : []
}

export function productToDraft(product: GolfReservationProduct): GolfReservationProductDraft {
  return {
    serviceId: product.reservationServiceId,
    displayName: product.displayName ?? '',
    playType: product.playType,
    holeCount: product.holeCount,
    expectedDurationMinutes: product.expectedDurationMinutes,
    golfCourseIds: productCourseIds(product),
    maxPlayersPerGroup: product.maxPlayersPerGroup ? String(product.maxPlayersPerGroup) : '',
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
 *
 * `existingHoleCount` likewise lets an existing product preserve a catalog
 * value such as 27 while new products remain restricted to 9 or 18 holes.
 */
export function validateProduct(
  draft: GolfReservationProductDraft,
  {
    requireCourse = false,
    existingHoleCount,
  }: {
    requireCourse?: boolean
    existingHoleCount?: number | null
  } = {},
) {
  if (!draft.displayName.trim()) return i18next.t('products:validation.displayNameRequired')
  if ([...draft.displayName.trim()].length > 255) {
    return i18next.t('products:validation.displayNameLength')
  }
  if (!draft.serviceId.trim()) return i18next.t('products:validation.serviceIdRequired')
  if (!/^[A-Za-z0-9._:-]+$/.test(draft.serviceId.trim())) {
    return i18next.t('products:validation.serviceIdFormat')
  }
  if (requireCourse && draft.golfCourseIds.length === 0) {
    return i18next.t('products:validation.courseRequired')
  }
  if (draft.maxPlayersPerGroup.trim()) {
    const players = Number(draft.maxPlayersPerGroup)
    if (!Number.isInteger(players) || players < 1 || players > 99) {
      return i18next.t('products:validation.maxPlayers')
    }
  }
  if (
    ![9, 18].includes(draft.holeCount)
    && draft.holeCount !== existingHoleCount
  ) {
    return i18next.t('products:validation.holeCount')
  }
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

/** How many rows the operator has to fix before the week can be saved. */
export function countSlotIssues(slots: GolfProductSlot[]) {
  return collectSlotIssues(slots).filter(codes => codes.length > 0).length
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

export function weekdayForIsoDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}
