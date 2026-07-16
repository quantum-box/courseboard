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
  playType: PlayType
  holeCount: number
  expectedDurationMinutes: number
  createdAt: string
  updatedAt: string
}

export type GolfReservationProductDraft = {
  serviceId: string
  playType: PlayType
  holeCount: number
  expectedDurationMinutes: number
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

export const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'] as const

export function emptyCourseDraft(): GolfCourseDraft {
  return {
    name: '',
    shortName: '',
    holeCount: 18,
    timezone: 'Asia/Tokyo',
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
    playType: 'caddie',
    holeCount: 18,
    expectedDurationMinutes: defaultDuration('caddie', 18),
  }
}

export function productToDraft(product: GolfReservationProduct): GolfReservationProductDraft {
  return {
    serviceId: product.reservationServiceId,
    playType: product.playType,
    holeCount: product.holeCount,
    expectedDurationMinutes: product.expectedDurationMinutes,
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

export function validateSlots(slots: GolfProductSlot[]) {
  const errors: string[] = []
  const keys = new Set<string>()

  slots.forEach((slot, index) => {
    const row = index + 1
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6) {
      errors.push(`${row}行目: 曜日を選択してください。`)
    }
    if (!validTime(slot.startTime) || !validTime(slot.endTime)) {
      errors.push(`${row}行目: 開始・終了時刻を入力してください。`)
    } else if (slot.startTime >= slot.endTime) {
      errors.push(`${row}行目: 終了時刻は開始時刻より後にしてください。`)
    }
    if (!Number.isInteger(slot.maxGroups) || slot.maxGroups < 0) {
      errors.push(`${row}行目: 最大組数は0以上の整数で入力してください。`)
    }
    if (!Number.isInteger(slot.maxPlayers) || slot.maxPlayers < 0) {
      errors.push(`${row}行目: 最大人数は0以上の整数で入力してください。`)
    }

    const key = `${slot.weekday}|${slot.startTime}|${slot.endTime}`
    if (keys.has(key)) {
      errors.push(`${row}行目: 同じ曜日・時間帯の枠が重複しています。`)
    }
    keys.add(key)
  })

  return Array.from(new Set(errors))
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
