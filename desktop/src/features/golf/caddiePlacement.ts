/** Placement states carried by recommendation and auto-assignment responses. */
export type ShiftPlacementStatus = 'unconfirmed' | 'unplaced' | 'on_course'

export type PlacementWarningStatus = Exclude<ShiftPlacementStatus, 'on_course'>

/** Return only the states that need an operator-facing warning. */
export function placementWarningStatus(
  status: string | null | undefined,
): PlacementWarningStatus | null {
  return status === 'unconfirmed' || status === 'unplaced' ? status : null
}
