import { describe, expect, it } from 'vitest'
import { profilePatchPayload } from './caddieProfileEdit'

const PROFILE = {
  displayName: 'HRMで表示中の名前',
  staffId: 'staff_aya',
  staffReferenceType: 'staff_member',
  staffReferenceId: 'staff_aya',
  skillLevel: 'regular',
  rank: 'C',
  employmentStatus: 'active',
  baseFeeAmount: 12_000,
  currency: 'JPY',
  maxRoundsPerDay: 2,
  monthlyContractRounds: 25,
  canTwoRounds: false,
  desiredIncome: 200_000,
}

describe('profilePatchPayload', () => {
  it('never writes a displayName for a linked profile', () => {
    const rankOnly = profilePatchPayload(PROFILE, { rank: 'A' })
    const forcedName = profilePatchPayload(PROFILE, {
      displayName: 'プロフィールに保存してはいけない名前',
    })

    expect(rankOnly).not.toHaveProperty('displayName')
    expect(rankOnly.rank).toBe('A')
    expect(forcedName).not.toHaveProperty('displayName')
  })

  it('keeps displayName editable for an unlinked legacy profile', () => {
    const payload = profilePatchPayload({
      ...PROFILE,
      staffId: null,
      staffReferenceType: 'external',
      staffReferenceId: null,
    }, { displayName: '外部キャディ' })

    expect(payload.displayName).toBe('外部キャディ')
  })

  it('omits displayName while linking a legacy profile to staff', () => {
    const payload = profilePatchPayload({
      ...PROFILE,
      staffId: null,
      staffReferenceType: 'external',
      staffReferenceId: null,
    }, { staffId: 'staff_new' })

    expect(payload).not.toHaveProperty('displayName')
    expect(payload.staffReferenceId).toBe('staff_new')
  })
})
