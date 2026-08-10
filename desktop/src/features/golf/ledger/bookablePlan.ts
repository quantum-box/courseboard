/** Plans the desk can book a tee time under, or move a booking onto. */
export type BookablePlan = {
  reservationServiceId: string
  label: string
  /** Whether the round is sold with a caddie. Drives the badge on the list. */
  playType: 'caddie' | 'self'
  expectedDurationMinutes: number
  golfCourseId?: string | null
  /** Players this plan sells in one group; absent means the general cap. */
  maxPlayersPerGroup?: number | null
}

/**
 * Plans sellable on one course.
 *
 * A plan sold on another course would put the round on a tee sheet the desk is
 * not looking at; a plan naming no course is sold everywhere.
 */
export function plansForCourse(plans: BookablePlan[], golfCourseId: string | undefined) {
  return plans.filter(plan => !plan.golfCourseId || plan.golfCourseId === golfCourseId)
}
