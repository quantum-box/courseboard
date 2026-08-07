import { describe, expect, it } from 'vitest'
import {
  bandStartCount,
  collectRuleIssues,
  copyWeekdayRules,
  countRuleIssues,
  nextRuleForWeekday,
  sortRules,
  summarizeRuleChanges,
  weeklyStartCount,
  type GolfAvailabilityRule,
} from './schedule'

function rule(overrides: Partial<GolfAvailabilityRule> = {}): GolfAvailabilityRule {
  return {
    weekday: 1,
    startTime: '07:00',
    endTime: '12:00',
    capacity: 1,
    slotIntervalMinutes: 8,
    ...overrides,
  }
}

describe('collectRuleIssues', () => {
  it('flags both bands of an overlap, not just the later one', () => {
    // Either row could be the one the operator meant to move, so pointing at
    // one of them would send half of them to the wrong field.
    const issues = collectRuleIssues([
      rule({ startTime: '07:00', endTime: '12:00' }),
      rule({ startTime: '11:00', endTime: '15:00' }),
    ])

    expect(issues[0]).toContain('overlap')
    expect(issues[1]).toContain('overlap')
  })

  it('lets bands touch end to start', () => {
    expect(countRuleIssues([
      rule({ startTime: '07:00', endTime: '12:00' }),
      rule({ startTime: '12:00', endTime: '15:00' }),
    ])).toBe(0)
  })

  it('does not call the same band on two weekdays an overlap', () => {
    expect(countRuleIssues([rule({ weekday: 1 }), rule({ weekday: 2 })])).toBe(0)
  })

  it('refuses a band that cannot generate anything', () => {
    expect(collectRuleIssues([rule({ capacity: 0 })])[0]).toContain('capacity')
    expect(collectRuleIssues([rule({ slotIntervalMinutes: 0 })])[0]).toContain('interval')
    expect(collectRuleIssues([rule({ startTime: '15:00', endTime: '09:00' })])[0]).toContain('order')
  })
})

describe('summarizeRuleChanges', () => {
  it('counts what replacing the schedule would add, drop, and rewrite', () => {
    const baseline = [rule({ weekday: 1 }), rule({ weekday: 2 }), rule({ weekday: 3 })]
    const current = [
      rule({ weekday: 1 }),
      rule({ weekday: 2, capacity: 2 }),
      rule({ weekday: 6 }),
    ]

    expect(summarizeRuleChanges(baseline, current)).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
    })
  })

  it('notices an interval change on an otherwise identical band', () => {
    expect(summarizeRuleChanges([rule()], [rule({ slotIntervalMinutes: 10 })]))
      .toEqual({ added: 0, removed: 0, changed: 1 })
  })

  it('reports nothing when a value is edited back to what it was', () => {
    expect(summarizeRuleChanges([rule()], [rule()]))
      .toEqual({ added: 0, removed: 0, changed: 0 })
  })
})

describe('copyWeekdayRules', () => {
  it('replaces each target weekday, and never the source', () => {
    const monday = [
      rule({ weekday: 1, startTime: '07:00', endTime: '12:00' }),
      rule({ weekday: 1, startTime: '12:00', endTime: '15:00' }),
    ]
    const copied = copyWeekdayRules(
      [...monday, rule({ weekday: 2, startTime: '09:00', endTime: '10:00' })],
      1,
      [1, 2, 3],
    )

    expect(copied.filter(row => row.weekday === 1)).toEqual(monday)
    expect(copied.filter(row => row.weekday === 2)).toHaveLength(2)
    expect(copied.filter(row => row.weekday === 3)).toHaveLength(2)
  })
})

describe('nextRuleForWeekday', () => {
  it('opens the next band where the day ends, keeping the day’s interval', () => {
    const next = nextRuleForWeekday([rule({ weekday: 1, endTime: '12:00', slotIntervalMinutes: 10 })], 1)
    expect(next.startTime).toBe('12:00')
    expect(next.slotIntervalMinutes).toBe(10)
  })

  it('falls back to the default band on an empty day', () => {
    expect(nextRuleForWeekday([rule({ weekday: 1 })], 4).startTime).toBe('07:00')
  })
})

describe('bandStartCount', () => {
  it('counts one start per interval, including the closing minute', () => {
    // 07:00-12:00 is 300 minutes; 8 minutes apart is 37 gaps, so 38 starts.
    expect(bandStartCount(rule({ startTime: '07:00', endTime: '12:00', slotIntervalMinutes: 8 }))).toBe(38)
    expect(bandStartCount(rule({ startTime: '07:00', endTime: '08:00', slotIntervalMinutes: 10 }))).toBe(7)
  })

  it('has no answer for a band that cannot generate', () => {
    expect(bandStartCount(rule({ startTime: '12:00', endTime: '07:00' }))).toBeNull()
    expect(bandStartCount(rule({ slotIntervalMinutes: 0 }))).toBeNull()
  })

  it('adds the week up for the save summary', () => {
    expect(weeklyStartCount([
      rule({ weekday: 1, startTime: '07:00', endTime: '08:00', slotIntervalMinutes: 10 }),
      rule({ weekday: 2, startTime: '07:00', endTime: '08:00', slotIntervalMinutes: 10 }),
    ])).toBe(14)
  })
})

describe('sortRules', () => {
  it('reads the week in weekday then time order', () => {
    const sorted = sortRules([
      rule({ weekday: 3, startTime: '12:00' }),
      rule({ weekday: 1, startTime: '12:00' }),
      rule({ weekday: 1, startTime: '07:00' }),
    ])

    expect(sorted.map(row => `${row.weekday}/${row.startTime}`))
      .toEqual(['1/07:00', '1/12:00', '3/12:00'])
  })
})
