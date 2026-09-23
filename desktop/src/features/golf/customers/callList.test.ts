import { describe, expect, it } from 'vitest'

import {
  CALL_LIST_DEFAULTS,
  CALL_LIST_PAGE_SIZE,
  callListQuery,
  callListSortForColumn,
  daysSince,
  isStale,
  naturalAscending,
  STALE_AFTER_DAYS,
  type CustomerSummaryRun,
} from './callList'

const NOW = Date.parse('2026-08-31T00:00:00Z')

function run(overrides: Partial<CustomerSummaryRun> = {}): CustomerSummaryRun {
  return {
    startedAt: '2026-08-30T18:00:00Z',
    finishedAt: '2026-08-30T18:04:00Z',
    status: 'succeeded',
    reservationsScanned: 1_200,
    customersWritten: 340,
    ...overrides,
  }
}

describe('callListQuery', () => {
  it('asks for the lapsed regulars, richest first, by default', () => {
    const query = callListQuery(CALL_LIST_DEFAULTS)
    expect(query).toContain('sort=total_amount')
    expect(query).toContain('minDaysSinceLastVisit=90')
    expect(query).toContain('minVisits=2')
    expect(query).toContain(`limit=${CALL_LIST_PAGE_SIZE}`)
    expect(query).not.toContain('offset')
    // Descending is the default upstream, so the biggest spender is the top of
    // the list without the screen having to say so.
    expect(query).not.toContain('ascending')
  })

  it('turns the last-visit order around so the longest absence comes first', () => {
    // Descending on a date would open the list with whoever played yesterday,
    // which is the opposite of who needs ringing.
    expect(callListQuery({ ...CALL_LIST_DEFAULTS, sort: 'last_visit', ascending: true }))
      .toContain('ascending=true')
    expect(naturalAscending('last_visit')).toBe(true)
    expect(naturalAscending('total_amount')).toBe(false)
  })

  it('asks the server for the page on screen rather than slicing a capped list', () => {
    const query = callListQuery(CALL_LIST_DEFAULTS, 2)
    expect(query).toContain(`limit=${CALL_LIST_PAGE_SIZE}`)
    expect(query).toContain(`offset=${CALL_LIST_PAGE_SIZE * 2}`)
  })

  it('maps a sortable column to the order the server knows it by', () => {
    expect(callListSortForColumn('spendPerPlayer')).toBe('spend_per_player')
    // Name and phone are Field's and cannot order the segment.
    expect(callListSortForColumn('name')).toBeNull()
  })

  it('treats a cleared box as no filter rather than as a filter of zero', () => {
    const query = callListQuery({
      ...CALL_LIST_DEFAULTS,
      minDaysSinceLastVisit: '',
      minVisits: '  ',
      minTotalAmount: '',
    })
    expect(query).not.toContain('minDaysSinceLastVisit')
    expect(query).not.toContain('minVisits')
    expect(query).not.toContain('minTotalAmount')
  })

  it('ignores something that is not a number rather than sending it upstream', () => {
    const query = callListQuery({ ...CALL_LIST_DEFAULTS, minVisits: 'ときどき' })
    expect(query).not.toContain('minVisits')
  })
})

describe('daysSince', () => {
  it('counts whole days back from the given moment', () => {
    expect(daysSince('2026-06-02T00:00:00Z', NOW)).toBe(90)
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a date', NOW)).toBeNull()
  })
})

describe('isStale', () => {
  it('says nothing when no refresh has ever run', () => {
    // Handled by its own message on the screen: "never run" and "ran a while
    // ago" send the desk to different places.
    expect(isStale(null, NOW)).toBe(false)
  })

  it('flags a refresh that failed, however recent it was', () => {
    expect(isStale(run({ status: 'failed' }), NOW)).toBe(true)
  })

  it('flags figures old enough that a nightly refresh has visibly missed one', () => {
    expect(isStale(run(), NOW)).toBe(false)
    const stale = run({
      finishedAt: new Date(NOW - STALE_AFTER_DAYS * 86_400_000).toISOString(),
    })
    expect(isStale(stale, NOW)).toBe(true)
  })
})
