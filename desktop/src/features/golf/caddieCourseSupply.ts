/**
 * How many caddie rounds a course can still take today.
 *
 * Read from `GET /v1/course/caddie-course-supply`, which counts confirmed
 * shifts against the groups already sold with a caddie. Shifts are
 * CourseBoard's own record rather than Field's, so a month nobody has
 * confirmed has no rows at all and every number here arrives as zero — that is
 * a real state of the club, not a failed lookup.
 */
export type CourseCaddieSupply = {
  golfCourseId: string
  courseName: string
  /** People standing at this course today. */
  workingCaddies: number
  /**
   * Rounds those people can take between them.
   *
   * Not the head count: a caddie cleared for two rounds counts twice.
   */
  roundsCapacity: number
  /** Groups already sold with a caddie attached. */
  caddieAttachedGroups: number
  /** Of the people here, how many are not pinned and could go elsewhere. */
  movableCaddies: number
  /** `roundsCapacity - caddieAttachedGroups`. Negative means oversold. */
  shortfall: number
  /** Assignment coverage counted after duplicate reservations are removed. */
  assignedGroups?: number
  /** Assigned groups whose caddie shift capacity was consumed. */
  backedAssignedGroups?: number
  /** Assigned groups with no confirmed working shift behind them. */
  unbackedAssignedGroups?: number
  /** Assigned groups beyond the selected shift's capacity. */
  capacityExceededAssignedGroups?: number
  /** Assigned groups whose shift course differs from the demand course. */
  courseMismatchAssignedGroups?: number
  /** Capacity after assignment coverage has consumed shift capacity. */
  effectiveRoundsCapacity?: number
  /** Demand after assignment coverage has been removed. */
  effectiveCaddieAttachedGroups?: number
  /** `effectiveRoundsCapacity - effectiveCaddieAttachedGroups`. */
  effectiveShortfall?: number
}

export type EffectiveCourseCaddieSupply = Pick<
  CourseCaddieSupply,
  'roundsCapacity' | 'caddieAttachedGroups' | 'shortfall'
>

/**
 * Read the assignment-aware values when the complete additive contract is
 * present, and keep the old raw display together when talking to an older API.
 * A partial response is not enough to mix raw demand with effective capacity.
 */
export function effectiveSupply(supply: CourseCaddieSupply): EffectiveCourseCaddieSupply {
  const {
    effectiveRoundsCapacity,
    effectiveCaddieAttachedGroups,
    effectiveShortfall,
  } = supply
  if (
    typeof effectiveRoundsCapacity === 'number'
    && typeof effectiveCaddieAttachedGroups === 'number'
    && typeof effectiveShortfall === 'number'
  ) {
    return {
      roundsCapacity: effectiveRoundsCapacity,
      caddieAttachedGroups: effectiveCaddieAttachedGroups,
      shortfall: effectiveShortfall,
    }
  }
  return {
    roundsCapacity: supply.roundsCapacity,
    caddieAttachedGroups: supply.caddieAttachedGroups,
    shortfall: supply.shortfall,
  }
}

export type DayCaddieSupply = {
  date: string
  courses: CourseCaddieSupply[]
  /** Confirmed to work, but no course decided for them yet. */
  unplacedCaddies: number
}

/** The day's courses by id, for a board that draws them in its own order. */
export function caddieSupplyByCourse(
  day: DayCaddieSupply | null | undefined,
): Map<string, CourseCaddieSupply> {
  return new Map((day?.courses ?? []).map(course => [course.golfCourseId, course]))
}
