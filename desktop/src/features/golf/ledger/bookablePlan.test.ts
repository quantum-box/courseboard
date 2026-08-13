import { describe, expect, it } from 'vitest'
import { plansForCourse, type BookablePlan } from './bookablePlan'

function plan(reservationServiceId: string, courses: Partial<BookablePlan>): BookablePlan {
  return {
    reservationServiceId,
    label: reservationServiceId,
    playType: 'caddie',
    expectedDurationMinutes: 240,
    ...courses,
  }
}

describe('plansForCourse', () => {
  const east = plan('east-only', { golfCourseIds: ['course_east'], golfCourseId: 'course_east' })
  const both = plan('season-pass', { golfCourseIds: ['course_east', 'course_west'] })
  const legacy = plan('legacy-scalar', { golfCourseId: 'course_west' })
  const everywhere = plan('no-course', {})
  const plans = [east, both, legacy, everywhere]

  it('offers a plan on every course it is sold on', () => {
    expect(plansForCourse(plans, 'course_east').map(item => item.reservationServiceId))
      .toEqual(['east-only', 'season-pass', 'no-course'])
    expect(plansForCourse(plans, 'course_west').map(item => item.reservationServiceId))
      .toEqual(['season-pass', 'legacy-scalar', 'no-course'])
  })

  it('keeps a multi-course plan off a course it is not sold on', () => {
    // The API sends no scalar alias for a plan on two courses. Reading only
    // that alias would call the plan unscoped and offer it here.
    expect(plansForCourse(plans, 'course_south').map(item => item.reservationServiceId))
      .toEqual(['no-course'])
  })

  it('falls back to plans sold everywhere when no course is in hand', () => {
    expect(plansForCourse(plans, undefined).map(item => item.reservationServiceId))
      .toEqual(['no-course'])
  })
})
