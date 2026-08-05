import { afterEach, describe, expect, it, vi } from 'vitest'
import { COURSE_TIME_ZONE, currentYearMonth, nowIsoMinute, today } from './clock'
import { parseJstDateParts } from '../features/golf/timeline/timelineLayout'

describe('the course clock', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is the courses own clock, not the machines', () => {
    expect(COURSE_TIME_ZONE).toBe('Asia/Tokyo')
  })

  it('rolls the date over on the course clock, not UTC', () => {
    // 07:00 course-local is the previous day in UTC — the reading that decides
    // which working day a punch belongs to.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T22:00:00Z'))
    expect(today()).toBe('2026-08-05')
    expect(nowIsoMinute()).toBe('2026-08-05T07:00')
    expect(currentYearMonth()).toBe('2026-08')
  })

  it('agrees with the timeline layouts own reading of a timestamp', () => {
    // Both used to carry their own copy of the zone; a drift between them would
    // put the now line on a different day from the board it is drawn on.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T22:00:00Z'))
    expect(parseJstDateParts(new Date().toISOString()).date).toBe(today())
  })
})
