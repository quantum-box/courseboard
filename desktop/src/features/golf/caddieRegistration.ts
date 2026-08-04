/**
 * Being a caddie is one role a Field staff member holds, so registering a
 * caddie is never a separate "link this profile to a staff member" step. The
 * dialog asks for a name; this module turns that name into either an existing
 * staff member or a body that leaves the link for the API to register.
 */

export type StaffCandidate = {
  id: string
  name: string
  active: boolean
}

export type CaddieCreateDraft = {
  name: string
  skillLevel: string
  rank: string
  baseFeeAmount: number
  /** Set once the operator picks a suggestion, or by an exact name match. */
  staffId?: string | null
}

/** The staff link as Field stores it, which is either field or both. */
export type CaddieStaffLink = {
  staffId?: string | null
  staffReferenceType?: string
  staffReferenceId?: string | null
}

/** Enough suggestions to disambiguate namesakes without burying the form. */
const SUGGESTION_LIMIT = 5

/**
 * Skill bands as Field spells them, mapped to the three the UI names.
 * `junior` is the older wire label for `rookie` and still comes back today.
 */
const SKILL_KEYS: Record<string, 'rookie' | 'regular' | 'veteran'> = {
  rookie: 'rookie',
  junior: 'rookie',
  regular: 'regular',
  veteran: 'veteran',
}

/** The translation key for a skill band, or `null` for a band we do not name. */
export function skillLabelKey(skill: string) {
  return SKILL_KEYS[skill] ?? null
}

/**
 * The staff member a caddie profile points at, from whichever of the two
 * fields Field filled in. `null` means a legacy profile nobody is behind.
 */
export function resolveStaffId(profile: CaddieStaffLink) {
  if (profile.staffId) return profile.staffId
  if (profile.staffReferenceType === 'staff_member' && profile.staffReferenceId) {
    return profile.staffReferenceId
  }
  return null
}

function normalize(value: string) {
  return value.trim().replace(/[\s　]+/g, '').toLocaleLowerCase('ja')
}

/**
 * Active staff whose name or id contains what the operator typed, so an
 * already-registered person is offered instead of registered twice.
 */
export function staffSuggestions(
  staff: StaffCandidate[],
  query: string,
  limit = SUGGESTION_LIMIT,
): StaffCandidate[] {
  const normalized = normalize(query)
  if (!normalized) return []
  return staff
    .filter(item => item.active)
    .filter(item => normalize(item.name).includes(normalized)
      || item.id.toLocaleLowerCase('ja').includes(normalized))
    .sort((left, right) => left.name.localeCompare(right.name, 'ja'))
    .slice(0, limit)
}

/**
 * The staff member a typed name unambiguously stands for.
 *
 * Namesakes stay unresolved on purpose: picking one of them silently would put
 * a round's pay on the wrong person, so the dialog asks instead.
 */
export function exactStaffMatch(
  staff: StaffCandidate[],
  name: string,
): StaffCandidate | null {
  const normalized = normalize(name)
  if (!normalized) return null
  const matches = staff.filter(item => item.active && normalize(item.name) === normalized)
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/**
 * Body for `POST /v1/course/caddie-profiles`.
 *
 * With no `staffId` the API registers a staff member under the same name and
 * links it, so the client never writes to the HRM master itself — one request,
 * no half-created staff member when the caddie write fails.
 */
export function caddieCreatePayload(draft: CaddieCreateDraft) {
  const name = draft.name.trim()
  const staffId = draft.staffId?.trim() || null
  return {
    displayName: name,
    skillLevel: draft.skillLevel,
    rank: draft.rank,
    baseFeeAmount: draft.baseFeeAmount,
    currency: 'JPY',
    ...(staffId
      ? { staffId, staffReferenceType: 'staff_member', staffReferenceId: staffId }
      : {}),
    active: true,
    employmentStatus: 'active',
    maxRoundsPerDay: 2,
  }
}
