import { describe, expect, it } from 'vitest'
import {
  initialYearMonthState,
  normalizeYearMonth,
  yearMonthDates,
  yearMonthReducer,
} from './yearMonth'

describe('normalizeYearMonth', () => {
  it.each([
    ['2026-2', '2026-02'],
    ['2026-02', '2026-02'],
    ['２０２６-２', '2026-02'],
    ['２０２６－０２', '2026-02'],
  ])('accepts %s as %s', (candidate, expected) => {
    expect(normalizeYearMonth(candidate)).toBe(expected)
  })

  it.each(['not-a-month', '', '2026-00', '2026-13', 'yearMonth must be YYYY-MM'])(
    'rejects %j without throwing',
    candidate => {
      expect(() => normalizeYearMonth(candidate)).not.toThrow()
      expect(normalizeYearMonth(candidate)).toBeNull()
      expect(yearMonthDates(candidate)).toEqual([])
    },
  )
})

describe('yearMonthReducer', () => {
  it.each(['not-a-month', '', '2026-00', '2026-13'])(
    'keeps the last valid month for %j',
    candidate => {
      const previous = initialYearMonthState('2026-02', '2026-01')
      const next = yearMonthReducer(previous, candidate)
      expect(next.value).toBe('2026-02')
      expect(next.error).not.toBeNull()
    },
  )

  it('normalizes a valid candidate before it reaches rendering', () => {
    const previous = initialYearMonthState('2026-01', '2025-12')
    expect(yearMonthReducer(previous, '２０２６-２')).toEqual({
      value: '2026-02',
      error: null,
    })
  })
})
