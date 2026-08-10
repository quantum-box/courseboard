import { describe, expect, it } from 'vitest'
import {
  calendarSelectionAfterClick,
  isCalendarToday,
  tenantTimezoneFromConfig,
  type CalendarDateSelection,
} from './availabilityCalendar'

describe('availability calendar range selection', () => {
  it('keeps the last plain click as the anchor while Shift ranges move', () => {
    const anchored = calendarSelectionAfterClick(
      { anchor: null, dates: [] },
      '2026-10-10',
      false,
    )
    const extended = calendarSelectionAfterClick(anchored, '2026-10-15', true)
    const shortened = calendarSelectionAfterClick(extended, '2026-10-12', true)

    expect(extended.anchor).toBe('2026-10-10')
    expect(shortened).toEqual({
      anchor: '2026-10-10',
      dates: ['2026-10-10', '2026-10-11', '2026-10-12'],
    })
  })

  it('selects every day in a mixed range instead of toggling existing days', () => {
    const mixed: CalendarDateSelection = {
      anchor: '2026-10-10',
      dates: ['2026-10-10', '2026-10-12'],
    }

    expect(calendarSelectionAfterClick(mixed, '2026-10-14', true)).toEqual({
      anchor: '2026-10-10',
      dates: [
        '2026-10-10',
        '2026-10-11',
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
      ],
    })
  })

  it('supports a range selected backwards without moving the anchor', () => {
    expect(calendarSelectionAfterClick(
      { anchor: '2026-10-10', dates: ['2026-10-10'] },
      '2026-10-07',
      true,
    )).toEqual({
      anchor: '2026-10-10',
      dates: ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'],
    })
  })
})

describe('availability calendar today', () => {
  it('uses a fixed instant in the tenant timezone', () => {
    const now = new Date('2026-08-04T22:00:00Z')

    expect(isCalendarToday('2026-08-05', now, 'Asia/Tokyo')).toBe(true)
    expect(isCalendarToday('2026-08-04', now, 'Asia/Tokyo')).toBe(false)
    expect(isCalendarToday('2026-08-04', now, 'UTC')).toBe(true)
  })

  it('uses the SCC-6 compatibility default only for an absent or blank key', () => {
    expect(tenantTimezoneFromConfig({})).toBe('Asia/Tokyo')
    expect(tenantTimezoneFromConfig({ timezone: '  ' })).toBe('Asia/Tokyo')
    expect(tenantTimezoneFromConfig({ timezone: 'Europe/Berlin' })).toBe('Europe/Berlin')
    expect(() => tenantTimezoneFromConfig({ timezone: 9 })).toThrow(RangeError)
    expect(() => tenantTimezoneFromConfig({ timezone: 'not-a-timezone' })).toThrow(RangeError)
  })
})
