import { describe, expect, it } from 'vitest'

import {
  emptyPlanDraft,
  planDraft,
  planRequestBody,
  validatePlanDraft,
  type MembershipPlan,
} from './membership'

function plan(overrides: Partial<MembershipPlan> = {}): MembershipPlan {
  return {
    id: 'plan_1',
    name: '正会員',
    feeJpy: 120000,
    active: true,
    sortOrder: 0,
    ...overrides,
  }
}

describe('membership plan drafts', () => {
  it('needs a name', () => {
    expect(validatePlanDraft({ ...emptyPlanDraft(0), name: '  ' })).toBe('nameRequired')
  })

  it('accepts a plan with nothing but a name', () => {
    // A club that does not track the fee here still has the membership.
    expect(validatePlanDraft({ ...emptyPlanDraft(0), name: '株主会員' })).toBeNull()
  })

  it('refuses a membership that expires the day it is granted', () => {
    const draft = { ...emptyPlanDraft(0), name: '平日会員', validDays: '0' }
    expect(validatePlanDraft(draft)).toBe('validDaysInvalid')
  })

  it('refuses a negative fee', () => {
    const draft = { ...emptyPlanDraft(0), name: '正会員', feeJpy: '-1' }
    expect(validatePlanDraft(draft)).toBe('feeInvalid')
  })

  it('sends a cleared fee as null so clearing it actually clears it', () => {
    // An absent key means "leave it alone" upstream, so a fee the desk
    // deleted would come back on the next read.
    const draft = { ...planDraft(plan()), feeJpy: '' }
    expect(planRequestBody(draft)).toMatchObject({ feeJpy: null, active: true })
  })

  it('omits the active flag when creating, since a new plan is always sold', () => {
    const body = planRequestBody({ ...emptyPlanDraft(2), name: '法人会員' })
    expect('active' in body).toBe(false)
    expect(body).toMatchObject({ name: '法人会員', sortOrder: 2 })
  })

  it('round-trips a stored plan through the editor unchanged', () => {
    const draft = planDraft(plan({ validDays: 365, description: '年会費制' }))
    expect(planRequestBody(draft)).toMatchObject({
      name: '正会員',
      feeJpy: 120000,
      validDays: 365,
      description: '年会費制',
    })
  })
})
