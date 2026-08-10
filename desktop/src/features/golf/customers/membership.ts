/** A membership a course sells (正会員, 平日会員, 株主会員, …). */
export type MembershipPlan = {
  id: string
  name: string
  description?: string | null
  feeJpy?: number | null
  /** How long one membership runs. Absent means it does not expire on its own. */
  validDays?: number | null
  active: boolean
  sortOrder: number
}

/**
 * Where one customer stands with the course.
 *
 * `isMember` is the server's answer, not something to re-derive from whether
 * `plan` is present. What counts as a member is a golf judgement and it lives
 * on the server; two places deciding it is how they come to disagree.
 */
export type CustomerMembership = {
  customerId: string
  isMember: boolean
  plan?: MembershipPlan | null
  startedOn?: string | null
}

export type MembershipPlanList = {
  items: MembershipPlan[]
}

export const membershipPlansPath = '/v1/course/membership-plans'

export function membershipPath(customerId: string): string {
  return `/v1/course/customers/${encodeURIComponent(customerId)}/membership`
}

/** A plan row being edited. Numbers are strings while the desk is typing. */
export type MembershipPlanDraft = {
  id: string | null
  name: string
  description: string
  feeJpy: string
  validDays: string
  active: boolean
  sortOrder: number
}

export function planDraft(plan: MembershipPlan): MembershipPlanDraft {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description ?? '',
    feeJpy: typeof plan.feeJpy === 'number' ? String(plan.feeJpy) : '',
    validDays: typeof plan.validDays === 'number' ? String(plan.validDays) : '',
    active: plan.active,
    sortOrder: plan.sortOrder,
  }
}

export function emptyPlanDraft(sortOrder: number): MembershipPlanDraft {
  return {
    id: null,
    name: '',
    description: '',
    feeJpy: '',
    validDays: '',
    active: true,
    sortOrder,
  }
}

export type PlanDraftError =
  | 'nameRequired'
  | 'feeInvalid'
  | 'validDaysInvalid'

export function validatePlanDraft(draft: MembershipPlanDraft): PlanDraftError | null {
  if (!draft.name.trim()) return 'nameRequired'
  if (draft.feeJpy.trim()) {
    const fee = Number(draft.feeJpy)
    if (!Number.isFinite(fee) || fee < 0 || !Number.isInteger(fee)) return 'feeInvalid'
  }
  if (draft.validDays.trim()) {
    const days = Number(draft.validDays)
    // Zero is a membership that expires the moment it is granted, which is
    // never what the desk means and reads as "no expiry" once stored.
    if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days)) return 'validDaysInvalid'
  }
  return null
}

/** Blank optional fields are sent as null so clearing one actually clears it. */
export function planRequestBody(draft: MembershipPlanDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    feeJpy: draft.feeJpy.trim() ? Number(draft.feeJpy) : null,
    validDays: draft.validDays.trim() ? Number(draft.validDays) : null,
    sortOrder: draft.sortOrder,
    ...(draft.id ? { active: draft.active } : {}),
  }
}
