import { describe, expect, it } from 'vitest'
import {
  applyCapacityToSlots,
  bandGroupCapacity,
  calculateCaddieCapacity,
  capacityAfterLoad,
  collectSlotOvercommits,
  collectSlotIssues,
  copyWeekdaySlots,
  countSlotIssues,
  nextSlotForWeekday,
  sortSlots,
  summarizeSlotChanges,
  validateProduct,
  weekdayGroupLoad,
  type CaddieSlotCapacity,
  type GolfProductSlot,
} from './models'

function slot(overrides: Partial<GolfProductSlot> = {}): GolfProductSlot {
  return {
    weekday: 1,
    startTime: '07:00',
    endTime: '12:00',
    maxGroups: 4,
    maxPlayers: 16,
    ...overrides,
  }
}

describe('countSlotIssues', () => {
  it('rejects reversed time ranges and duplicate rows', () => {
    const reversed = slot({ startTime: '12:00', endTime: '07:00' })
    expect(countSlotIssues([reversed, { ...reversed }])).toBe(2)
  })

  it('accepts distinct valid slots', () => {
    expect(countSlotIssues([
      slot({ startTime: '07:00', endTime: '12:00' }),
      slot({ startTime: '12:00', endTime: '15:00' }),
    ])).toBe(0)
  })
})

describe('collectSlotIssues', () => {
  it('reports the issue on the offending row, not on the week', () => {
    const issues = collectSlotIssues([
      slot(),
      slot({ startTime: '15:00', endTime: '13:00' }),
      slot(),
    ])

    expect(issues[0]).toEqual([])
    expect(issues[1]).toEqual(['order'])
    // The third row repeats the first one's weekday and band.
    expect(issues[2]).toEqual(['duplicate'])
  })
})

describe('bandGroupCapacity', () => {
  it('counts the starts a band fits, including the one on the closing minute', () => {
    // 07:00–12:00 is 300 minutes; at 8 minutes apart that is 37 gaps, 38 starts.
    expect(bandGroupCapacity('07:00', '12:00', 8)).toBe(38)
    expect(bandGroupCapacity('07:00', '08:00', 10)).toBe(7)
  })

  it('has no answer without a usable course interval or band', () => {
    expect(bandGroupCapacity('07:00', '12:00', null)).toBeNull()
    expect(bandGroupCapacity('07:00', '12:00', 0)).toBeNull()
    expect(bandGroupCapacity('12:00', '07:00', 8)).toBeNull()
    expect(bandGroupCapacity('', '12:00', 8)).toBeNull()
  })
})

describe('collectSlotOvercommits', () => {
  it('names the real ceiling only for rows that promise more than it', () => {
    const overcommits = collectSlotOvercommits([
      // 60 minutes at 10 apart is 7 starts; 9 is more than the tee can send out.
      slot({ startTime: '07:00', endTime: '08:00', maxGroups: 9 }),
      slot({ startTime: '07:00', endTime: '08:00', maxGroups: 7 }),
      // 0 means no limit, which no interval can contradict.
      slot({ startTime: '07:00', endTime: '08:00', maxGroups: 0 }),
    ], 10)

    expect(overcommits).toEqual([7, null, null])
  })

  it('stays quiet when the plan names no course to measure against', () => {
    expect(collectSlotOvercommits([slot({ maxGroups: 999 })], null)).toEqual([null])
  })
})

describe('summarizeSlotChanges', () => {
  it('counts what a whole-week replace would add, drop, and rewrite', () => {
    const baseline = [
      slot({ weekday: 1 }),
      slot({ weekday: 2 }),
      slot({ weekday: 3 }),
    ]
    const current = [
      // Untouched.
      slot({ weekday: 1 }),
      // Same band, new limits.
      slot({ weekday: 2, maxGroups: 6 }),
      // Weekday 3 is gone, Saturday is new.
      slot({ weekday: 6 }),
    ]

    expect(summarizeSlotChanges(baseline, current)).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
    })
  })

  it('sees a band moved to another time as a removal plus an addition', () => {
    expect(summarizeSlotChanges(
      [slot({ startTime: '07:00', endTime: '12:00' })],
      [slot({ startTime: '08:00', endTime: '12:00' })],
    )).toEqual({ added: 1, removed: 1, changed: 0 })
  })

  it('reports nothing when the operator edits a value back to what it was', () => {
    expect(summarizeSlotChanges([slot()], [slot()])).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
    })
  })
})

describe('copyWeekdaySlots', () => {
  it('replaces each target weekday with the source weekday, and never itself', () => {
    const monday = [
      slot({ weekday: 1, startTime: '07:00', endTime: '12:00' }),
      slot({ weekday: 1, startTime: '12:00', endTime: '15:00' }),
    ]
    const copied = copyWeekdaySlots(
      [...monday, slot({ weekday: 2, startTime: '09:00', endTime: '10:00', maxGroups: 1 })],
      1,
      [1, 2, 3],
    )

    expect(copied.filter(row => row.weekday === 1)).toEqual(monday)
    // Tuesday's own band is replaced rather than merged with the copies.
    expect(copied.filter(row => row.weekday === 2)).toEqual([
      slot({ weekday: 2, startTime: '07:00', endTime: '12:00' }),
      slot({ weekday: 2, startTime: '12:00', endTime: '15:00' }),
    ])
    expect(copied.filter(row => row.weekday === 3)).toHaveLength(2)
  })

  it('leaves the week alone when the only target is the source', () => {
    const week = [slot({ weekday: 1 })]
    expect(copyWeekdaySlots(week, 1, [1])).toBe(week)
  })
})

describe('nextSlotForWeekday', () => {
  it('opens the next band where the day currently ends', () => {
    expect(nextSlotForWeekday([slot({ weekday: 1, endTime: '12:00' })], 1)).toEqual({
      weekday: 1,
      startTime: '12:00',
      endTime: '15:00',
      maxGroups: 0,
      maxPlayers: 0,
    })
  })

  it('falls back to the default band on a day with nothing on it', () => {
    expect(nextSlotForWeekday([slot({ weekday: 1 })], 4)).toEqual({
      weekday: 4,
      startTime: '07:00',
      endTime: '12:00',
      maxGroups: 0,
      maxPlayers: 0,
    })
  })

  it('does not run a day past midnight', () => {
    const next = nextSlotForWeekday([slot({ weekday: 1, endTime: '23:30' })], 1)
    expect(next.startTime < next.endTime).toBe(true)
  })
})

describe('sortSlots', () => {
  it('reads the week in weekday then time order', () => {
    const sorted = sortSlots([
      slot({ weekday: 3, startTime: '12:00' }),
      slot({ weekday: 1, startTime: '12:00' }),
      slot({ weekday: 1, startTime: '07:00' }),
    ])

    expect(sorted.map(row => `${row.weekday}/${row.startTime}`)).toEqual([
      '1/07:00',
      '1/12:00',
      '3/12:00',
    ])
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

describe('weekdayGroupLoad', () => {
  it('splits another plan\u2019s weekday at midday', () => {
    const load = weekdayGroupLoad([
      slot({ weekday: 1, startTime: '07:00', endTime: '11:00', maxGroups: 4 }),
      slot({ weekday: 1, startTime: '11:00', endTime: '12:00', maxGroups: 2 }),
      slot({ weekday: 1, startTime: '12:00', endTime: '15:00', maxGroups: 3 }),
      // Another weekday entirely.
      slot({ weekday: 2, startTime: '07:00', endTime: '11:00', maxGroups: 9 }),
    ], 1)

    expect(load).toEqual({ morning: 6, afternoon: 3, unlimited: false })
  })

  it('reports an uncapped band rather than counting it as zero', () => {
    const load = weekdayGroupLoad([
      slot({ weekday: 1, maxGroups: 4 }),
      slot({ weekday: 1, startTime: '12:00', endTime: '15:00', maxGroups: 0 }),
    ], 1)

    expect(load.unlimited).toBe(true)
  })
})

describe('capacityAfterLoad', () => {
  const supply: CaddieSlotCapacity = {
    morningCapacity: 5,
    afternoonCapacity: 4,
    totalRounds: 8,
    activeCaddies: 5,
    unavailable: 0,
    assumedAvailable: 0,
  }

  it('leaves this plan only the caddies the other plans did not take', () => {
    const left = capacityAfterLoad(supply, { morning: 2, afternoon: 1, unlimited: false })
    expect(left.morningCapacity).toBe(3)
    expect(left.afternoonCapacity).toBe(3)
  })

  it('never goes negative when the course is already oversold', () => {
    const left = capacityAfterLoad(supply, { morning: 9, afternoon: 9, unlimited: false })
    expect(left.morningCapacity).toBe(0)
    expect(left.afternoonCapacity).toBe(0)
  })

  it('subtracts nothing it cannot count, rather than guessing', () => {
    expect(capacityAfterLoad(supply, { morning: 2, afternoon: 1, unlimited: true })).toEqual(supply)
    expect(capacityAfterLoad(supply, null)).toEqual(supply)
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
    golfCourseId: 'course_east',
  }

  it('accepts a plan an operator would really enter', () => {
    expect(validateProduct(valid)).toBeNull()
  })

  it('still saves a plan that names no course, so existing plans stay editable', () => {
    expect(validateProduct({ ...valid, golfCourseId: '' })).toBeNull()
  })

  it('makes a new plan name its course, which is how the backlog empties', () => {
    expect(validateProduct({ ...valid, golfCourseId: '' }, { requireCourse: true }))
      .not.toBeNull()
    expect(validateProduct(valid, { requireCourse: true })).toBeNull()
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
