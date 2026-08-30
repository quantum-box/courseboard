import { describe, expect, it } from 'vitest'

import { roundsPerYear, visitDate, visitTime, type CustomerVisitSummary } from './visits'

function summary(overrides: Partial<CustomerVisitSummary> = {}): CustomerVisitSummary {
  return {
    visits: 0,
    players: 0,
    totalAmount: 0,
    unpricedVisits: 0,
    cancelled: 0,
    noShows: 0,
    upcoming: 0,
    ...overrides,
  }
}

describe('how often somebody plays', () => {
  it('counts rounds against the span they were played over', () => {
    // Twelve rounds across a year is once a month, which is what the desk
    // means by a regular.
    expect(
      roundsPerYear(
        summary({
          visits: 12,
          firstVisitAt: '2025-08-01T00:00:00Z',
          lastVisitAt: '2026-08-01T00:00:00Z',
        }),
      ),
    ).toBe(12)
  })

  it('says nothing about a truncated history', () => {
    // Without a first visit the span is unknown, and dividing by the span of
    // one page would report a twenty-year member as a constant first-timer.
    expect(
      roundsPerYear(summary({ visits: 50, lastVisitAt: '2026-08-01T00:00:00Z' })),
    ).toBeNull()
  })

  it('says nothing about a single visit', () => {
    expect(
      roundsPerYear(
        summary({
          visits: 1,
          firstVisitAt: '2026-08-01T00:00:00Z',
          lastVisitAt: '2026-08-01T00:00:00Z',
        }),
      ),
    ).toBeNull()
  })

  it('refuses to extrapolate from two rounds a fortnight apart', () => {
    // 2 visits over 14 days is not 52 a year; it is two visits.
    expect(
      roundsPerYear(
        summary({
          visits: 2,
          firstVisitAt: '2026-07-18T00:00:00Z',
          lastVisitAt: '2026-08-01T00:00:00Z',
        }),
      ),
    ).toBeNull()
  })
})

describe('tee times in the tenant timezone', () => {
  it('keeps an early round on the course day, not the device day', () => {
    // 23:00 UTC is the next morning in Tokyo. A laptop left on UTC must not
    // move the round onto the previous date.
    expect(visitDate('2026-08-26T23:00:00Z', 'Asia/Tokyo')).toBe('2026-08-27')
    expect(visitTime('2026-08-26T23:00:00Z', 'Asia/Tokyo')).toBe('08:00')
  })

  it('renders nothing for an unparseable instant rather than "Invalid Date"', () => {
    expect(visitDate('not a date', 'Asia/Tokyo')).toBe('')
    expect(visitTime('not a date', 'Asia/Tokyo')).toBe('')
  })
})
