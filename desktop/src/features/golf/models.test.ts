import { describe, expect, it } from 'vitest'
import {
  applyCapacityToSlots,
  calculateCaddieCapacity,
  validateProduct,
  validateSlots,
  type CaddieSlotCapacity,
  type GolfProductSlot,
} from './models'

describe('validateSlots', () => {
  it('rejects reversed time ranges and duplicate rows', () => {
    const slots: GolfProductSlot[] = [
      {
        weekday: 1,
        startTime: '12:00',
        endTime: '07:00',
        maxGroups: 4,
        maxPlayers: 16,
      },
      {
        weekday: 1,
        startTime: '12:00',
        endTime: '07:00',
        maxGroups: 4,
        maxPlayers: 16,
      },
    ]

    expect(validateSlots(slots)).toEqual(expect.arrayContaining([
      '1行目: おわりは はじまりより後にしてください。',
      '2行目: 同じ曜日・同じ時間の枠が重なっています。',
    ]))
  })

  it('accepts distinct valid slots', () => {
    expect(validateSlots([
      {
        weekday: 1,
        startTime: '07:00',
        endTime: '12:00',
        maxGroups: 4,
        maxPlayers: 16,
      },
      {
        weekday: 1,
        startTime: '12:00',
        endTime: '15:00',
        maxGroups: 3,
        maxPlayers: 12,
      },
    ])).toEqual([])
  })
})

describe('calculateCaddieCapacity', () => {
  it('accounts for availability, missing preferences, and requested two-round shifts', () => {
    const result = calculateCaddieCapacity(
      [
        { id: 'a', active: true, canTwoRounds: true },
        { id: 'b', active: true, canTwoRounds: false },
        { id: 'c', active: true, canTwoRounds: true },
        { id: 'inactive', active: false, canTwoRounds: true },
      ],
      [
        { caddieProfileId: 'a', status: 'available', twoRoundRequest: true },
        { caddieProfileId: 'b', status: 'unavailable', twoRoundRequest: false },
      ],
    )

    expect(result).toEqual({
      morningCapacity: 2,
      afternoonCapacity: 2,
      totalRounds: 3,
      activeCaddies: 3,
      unavailable: 1,
      assumedAvailable: 1,
    })
  })
})

describe('applyCapacityToSlots', () => {
  it('creates morning and afternoon rows when the weekday is not configured', () => {
    const capacity: CaddieSlotCapacity = {
      morningCapacity: 5,
      afternoonCapacity: 3,
      totalRounds: 8,
      activeCaddies: 6,
      unavailable: 0,
      assumedAvailable: 0,
    }

    const slots = applyCapacityToSlots([], '2026-07-15', capacity)

    expect(slots).toEqual([
      {
        weekday: 3,
        startTime: '07:00',
        endTime: '12:00',
        maxGroups: 5,
        maxPlayers: 0,
      },
      {
        weekday: 3,
        startTime: '12:00',
        endTime: '15:00',
        maxGroups: 3,
        maxPlayers: 0,
      },
    ])
  })
})

describe('validateProduct', () => {
  const valid = {
    serviceId: 'weekday-18h',
    displayName: '平日18Hプレープラン',
    playType: 'caddie' as const,
    holeCount: 18,
    expectedDurationMinutes: 240,
  }

  it('accepts a plan an operator would really enter', () => {
    expect(validateProduct(valid)).toBeNull()
  })

  it('refuses the empty required fields the QA report reached the server with', () => {
    expect(validateProduct({ ...valid, displayName: '   ' })).not.toBeNull()
    expect(validateProduct({ ...valid, serviceId: '' })).not.toBeNull()
  })

  it('refuses a duration of zero or a negative one', () => {
    expect(validateProduct({ ...valid, expectedDurationMinutes: 0 })).not.toBeNull()
    expect(validateProduct({ ...valid, expectedDurationMinutes: -30 })).not.toBeNull()
  })

  it('holds the duration inside the range the plan can actually run', () => {
    expect(validateProduct({ ...valid, expectedDurationMinutes: 29 })).not.toBeNull()
    expect(validateProduct({ ...valid, expectedDurationMinutes: 30 })).toBeNull()
    expect(validateProduct({ ...valid, expectedDurationMinutes: 720 })).toBeNull()
    expect(validateProduct({ ...valid, expectedDurationMinutes: 721 })).not.toBeNull()
    expect(validateProduct({ ...valid, expectedDurationMinutes: 240.5 })).not.toBeNull()
  })

  it('only knows 9 and 18 holes', () => {
    expect(validateProduct({ ...valid, holeCount: 27 })).not.toBeNull()
    expect(validateProduct({ ...valid, holeCount: 0 })).not.toBeNull()
    expect(validateProduct({ ...valid, holeCount: 9 })).toBeNull()
  })

  it('keeps the service id to characters a URL path can carry', () => {
    // It is sent as a path segment, so a space or a slash would change the route.
    expect(validateProduct({ ...valid, serviceId: 'weekday 18h' })).not.toBeNull()
    expect(validateProduct({ ...valid, serviceId: 'weekday/18h' })).not.toBeNull()
    expect(validateProduct({ ...valid, serviceId: 'weekday_18h:a.b-c' })).toBeNull()
  })
})
