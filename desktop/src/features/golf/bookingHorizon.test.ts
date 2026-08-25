import { describe, expect, it } from 'vitest'

import {
  HORIZON_MAX_DAYS,
  addDays,
  emptyHorizonDraft,
  horizonDraftFrom,
  horizonIssue,
  horizonPayload,
  inventoryHorizonGap,
  sameHorizon,
} from './bookingHorizon'

const today = '2026-08-11'

describe('reading what the club has stored', () => {
  it('opens on the day count a rolling club keeps', () => {
    expect(
      horizonDraftFrom({
        mode: 'days',
        days: 180,
        through: null,
        bookableThrough: '2027-02-07',
      }),
    ).toEqual({ mode: 'days', days: '180', through: '' })
  })

  it('opens on the closing date a seasonal club named', () => {
    expect(
      horizonDraftFrom({
        mode: 'through',
        days: null,
        through: '2026-11-30',
        bookableThrough: '2026-11-30',
      }),
    ).toEqual({ mode: 'through', days: '', through: '2026-11-30' })
  })
})

describe('comparing configured and generated inventory edges', () => {
  it('keeps a missing generated edge distinct', () => {
    expect(inventoryHorizonGap('2027-02-19', null)).toEqual({
      bookableThrough: '2027-02-19',
      generatedThrough: null,
    })
  })

  it('reports inventory that stops before the configured edge', () => {
    expect(inventoryHorizonGap('2027-02-19', '2027-02-01')).toEqual({
      bookableThrough: '2027-02-19',
      generatedThrough: '2027-02-01',
    })
  })

  it('has no gap once generated inventory reaches the configured edge', () => {
    expect(inventoryHorizonGap('2027-02-19', '2027-02-19')).toBeNull()
  })
})

describe('what gets sent', () => {
  it('sends only the field the chosen mode is about', () => {
    expect(horizonPayload({ mode: 'days', days: '90', through: '2026-11-30' }))
      .toEqual({ days: 90 })
    expect(horizonPayload({ mode: 'through', days: '90', through: '2026-11-30' }))
      .toEqual({ through: '2026-11-30' })
  })
})

describe('what the screen refuses to send', () => {
  it('accepts a day count inside the window that can be generated', () => {
    expect(horizonIssue({ ...emptyHorizonDraft(), days: '1' }, today)).toBeNull()
    expect(horizonIssue({ ...emptyHorizonDraft(), days: '399' }, today)).toBeNull()
  })

  it.each(['', '0', '400', '30.5', 'soon'])('refuses %s as a day count', days => {
    expect(horizonIssue({ ...emptyHorizonDraft(), days }, today)).toBe('days')
  })

  it('accepts today and the furthest date that can still be built', () => {
    expect(horizonIssue({ mode: 'through', days: '', through: today }, today)).toBeNull()
    expect(
      horizonIssue(
        { mode: 'through', days: '', through: addDays(today, HORIZON_MAX_DAYS) },
        today,
      ),
    ).toBeNull()
  })

  it('refuses a closing date already behind the club today', () => {
    expect(
      horizonIssue({ mode: 'through', days: '', through: addDays(today, -1) }, today),
    ).toBe('through')
  })

  it('refuses a closing date past what one generate call may cover', () => {
    expect(
      horizonIssue(
        { mode: 'through', days: '', through: addDays(today, HORIZON_MAX_DAYS + 1) },
        today,
      ),
    ).toBe('through')
  })

  it.each(['', '2026-13-01', '30/11/2026'])('refuses %s as a closing date', through => {
    expect(horizonIssue({ mode: 'through', days: '', through }, today)).toBe('through')
  })
})

describe('deciding whether the horizon moved', () => {
  it('ignores the box the other mode left behind', () => {
    // Writing the horizon rebuilds every course, so a policy save that only
    // touched the cutoff must not look like a horizon change.
    expect(
      sameHorizon(
        { mode: 'days', days: '180', through: '' },
        { mode: 'days', days: '180', through: '2026-11-30' },
      ),
    ).toBe(true)
  })

  it('sees a mode switch as a change even when the far edge lands nearby', () => {
    expect(
      sameHorizon(
        { mode: 'days', days: '180', through: '2026-11-30' },
        { mode: 'through', days: '180', through: '2026-11-30' },
      ),
    ).toBe(false)
  })

  it('sees the chosen mode changing value', () => {
    expect(
      sameHorizon(
        { mode: 'through', days: '', through: '2026-11-30' },
        { mode: 'through', days: '', through: '2026-12-31' },
      ),
    ).toBe(false)
  })
})

describe('calendar arithmetic', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-08-11', 30)).toBe('2026-09-10')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})
