import { resolveStaffId, type CaddieStaffLink } from './caddieRegistration'

type CaddieProfileForEdit = CaddieStaffLink & {
  displayName: string
  skillLevel: string
  rank?: string
  employmentStatus: string
  baseFeeAmount: number
  currency: string
  maxRoundsPerDay: number
  monthlyContractRounds?: number
  canTwoRounds?: boolean
  desiredIncome?: number
}

type CaddieProfileOverrides = Partial<{
  displayName: string
  skillLevel: string
  rank: string
  employmentStatus: string
  baseFeeAmount: number
  currency: string
  maxRoundsPerDay: number
  staffId: string | null
}>

const EMPLOYMENT_STATUSES = ['active', 'inactive', 'suspended'] as const

function employmentStatusCode(status: string) {
  const folded = status.trim().toLowerCase()
  return (EMPLOYMENT_STATUSES as readonly string[]).includes(folded) ? folded : status.trim()
}

/**
 * Linked profiles take their name from HRM. Omitting `displayName` is crucial:
 * sending the merged staff name would write an invisible copy back into the
 * golf profile on every unrelated rank or fee edit.
 */
export function profilePatchPayload(
  profile: CaddieProfileForEdit,
  overrides: CaddieProfileOverrides = {},
) {
  const staffId = overrides.staffId === undefined
    ? resolveStaffId(profile)
    : overrides.staffId
  const employmentStatus = employmentStatusCode(
    overrides.employmentStatus ?? profile.employmentStatus,
  )
  return {
    staffId,
    caddieCode: null,
    staffReferenceType: staffId ? 'staff_member' : (profile.staffReferenceType ?? 'external'),
    staffReferenceId: staffId,
    // A legacy profile without a StaffMember still needs its own usable name.
    ...(!staffId ? { displayName: overrides.displayName ?? profile.displayName } : {}),
    skillLevel: overrides.skillLevel ?? profile.skillLevel,
    rank: overrides.rank ?? profile.rank,
    active: employmentStatus === 'active',
    employmentStatus,
    baseFeeAmount: overrides.baseFeeAmount ?? profile.baseFeeAmount,
    currency: overrides.currency ?? profile.currency,
    maxRoundsPerDay: overrides.maxRoundsPerDay ?? profile.maxRoundsPerDay,
    monthlyContractRounds: profile.monthlyContractRounds,
    canTwoRounds: profile.canTwoRounds,
    desiredIncome: profile.desiredIncome,
  }
}
