/** Plans the desk can book a tee time under, or move a booking onto. */
export type BookablePlan = {
  reservationServiceId: string
  label: string
  /** Whether the round is sold with a caddie. Drives the badge on the list. */
  playType: 'caddie' | 'self'
  expectedDurationMinutes: number
  /** Courses this plan is sold on; several when the same plan covers them. */
  golfCourseIds?: string[] | null
  /** Compatibility alias sent only for a plan on exactly one course. */
  golfCourseId?: string | null
  /** Players this plan sells in one group; absent means the general cap. */
  maxPlayersPerGroup?: number | null
}

function planCourseIds(plan: BookablePlan): string[] {
  if (plan.golfCourseIds) return plan.golfCourseIds
  return plan.golfCourseId ? [plan.golfCourseId] : []
}

/**
 * Plans sellable on one course.
 *
 * A plan sold on other courses would put the round on a tee sheet the desk is
 * not looking at; a plan naming no course is sold everywhere. A plan that names
 * several belongs on each of them — reading only the scalar alias would make it
 * look unscoped and offer it on courses it is not sold on.
 */
export function plansForCourse(plans: BookablePlan[], golfCourseId: string | undefined) {
  return plans.filter(plan => {
    const courseIds = planCourseIds(plan)
    return courseIds.length === 0
      || (golfCourseId !== undefined && courseIds.includes(golfCourseId))
  })
}
