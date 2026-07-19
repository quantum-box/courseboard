import { describe, expect, it } from 'vitest'
import type { TeeReservation, TimelineAssignment } from './models'
import {
  DEFAULT_PX_PER_HOUR,
  MAX_PX_PER_HOUR,
  MIN_PX_PER_HOUR,
  buildHourMarks,
  clampPxPerHour,
  coverageForReservation,
  enrichAssignmentsForTimeline,
  findOverlappingAssignmentIds,
  markStepMinutes,
  minutesToLabel,
  nowLinePercent,
  parseJstDateParts,
  parseLocalDateParts,
  summarizeDay,
  toTimelineBlock,
  trackWidthPx,
  zoomPercent,
} from './timelineLayout'

const reservation = (overrides: Partial<TeeReservation> = {}): TeeReservation => ({
  id: 'res_1',
  reservationNumber: 'R-1',
  golfCourseId: 'course_east',
  courseName: 'East',
  teeTime: '2026-07-18T08:00:00+09:00',
  durationMinutes: 270,
  playType: 'caddie',
  partySize: 4,
  partyName: 'Yamada',
  status: 'confirmed',
  holes: 18,
  ...overrides,
})

const assignment = (overrides: Partial<TimelineAssignment> = {}): TimelineAssignment => ({
  id: 'asn_1',
  caddieProfileId: 'caddie_aya',
  reservationId: 'res_1',
  scheduledAt: '2026-07-18T08:00:00+09:00',
  durationMinutes: 270,
  status: 'assigned',
  assignmentRole: 'primary',
  feeAmount: 12000,
  feeCurrency: 'JPY',
  ...overrides,
})

describe('timelineLayout', () => {
  it('parses tee-time minutes without depending on host timezone', () => {
    expect(parseLocalDateParts('2026-07-18T07:08:00+09:00')).toEqual({
      date: '2026-07-18',
      minutes: 7 * 60 + 8,
    })
    expect(minutesToLabel(7 * 60 + 8)).toBe('07:08')
  })

  it('maps UTC assignment timestamps into JST wall clock', () => {
    expect(parseJstDateParts('2026-07-17T22:00:00Z')).toEqual({
      date: '2026-07-18',
      minutes: 7 * 60,
    })
    expect(parseJstDateParts('2026-07-18T07:00:00+09:00')).toEqual({
      date: '2026-07-18',
      minutes: 7 * 60,
    })
  })

  it('fills missing assignment duration from linked tee-sheet item', () => {
    const enriched = enrichAssignmentsForTimeline(
      [assignment({ durationMinutes: undefined, reservationId: 'res_1' })],
      [reservation({ id: 'res_1', durationMinutes: 240 })],
    )
    expect(enriched[0]?.durationMinutes).toBe(240)
  })

  it('places blocks inside the day window', () => {
    const block = toTimelineBlock('b1', 8 * 60, 120, {
      startMinutes: 6 * 60,
      endMinutes: 18 * 60,
    })
    expect(block.leftPct).toBeCloseTo((2 / 12) * 100, 5)
    expect(block.widthPct).toBeCloseTo((2 / 12) * 100, 5)
  })

  it('builds hourly marks and now-line only for the selected day', () => {
    expect(buildHourMarks({ startMinutes: 6 * 60, endMinutes: 8 * 60 })).toEqual([
      360, 420, 480,
    ])
    expect(nowLinePercent('2026-07-18T09:00:00+09:00', '2026-07-18')).toBeCloseTo(25, 5)
    expect(nowLinePercent('2026-07-18T09:00:00+09:00', '2026-07-19')).toBeNull()
  })

  it('scales track width and mark density from px-per-hour zoom', () => {
    expect(clampPxPerHour(10)).toBe(MIN_PX_PER_HOUR)
    expect(clampPxPerHour(999)).toBe(MAX_PX_PER_HOUR)
    expect(trackWidthPx(120)).toBe(12 * 120)
    expect(markStepMinutes(80)).toBe(60)
    expect(markStepMinutes(120)).toBe(30)
    expect(markStepMinutes(200)).toBe(15)
    expect(zoomPercent(DEFAULT_PX_PER_HOUR)).toBe(100)
  })

  it('computes assignment coverage and conflicts', () => {
    expect(coverageForReservation(reservation({ playType: 'self' }), [])).toBe('not_required')
    expect(coverageForReservation(reservation(), [])).toBe('unassigned')
    expect(coverageForReservation(reservation(), [assignment()])).toBe('assigned')
    expect(
      coverageForReservation(reservation(), [
        assignment({ assignmentRole: 'assistant' }),
      ]),
    ).toBe('partial')

    const conflicts = findOverlappingAssignmentIds([
      assignment({ id: 'a', scheduledAt: '2026-07-18T08:00:00+09:00', durationMinutes: 240 }),
      assignment({
        id: 'b',
        scheduledAt: '2026-07-18T10:00:00+09:00',
        durationMinutes: 240,
      }),
      assignment({
        id: 'c',
        caddieProfileId: 'caddie_ken',
        scheduledAt: '2026-07-18T08:00:00+09:00',
        durationMinutes: 240,
      }),
    ])
    expect([...conflicts].sort()).toEqual(['a', 'b'])

    const summary = summarizeDay(
      [
        reservation({ id: 'r1' }),
        reservation({ id: 'r2', playType: 'self' }),
        reservation({ id: 'r3', teeTime: '2026-07-18T11:00:00+09:00' }),
      ],
      [assignment({ reservationId: 'r1' })],
    )
    expect(summary).toMatchObject({
      total: 3,
      caddieRequired: 2,
      selfPlay: 1,
      assigned: 1,
      unassigned: 1,
    })
  })
})
