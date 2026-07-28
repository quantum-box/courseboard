import { describe, expect, it } from 'vitest'
import {
  applyCapacityToSlots,
  calculateCaddieCapacity,
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
