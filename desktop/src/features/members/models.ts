/**
 * Tenant member and permission management backed by the Field IAM surface
 * (`/v1/field/iam/users*`) through the courseboard field proxy. Upstream gates
 * every call with the ERP action `field:ManageUsers` (tenant owners pass via
 * the owner bypass).
 *
 * There is no separate notion of a role: a role *is* a policy. What the server
 * calls a member's role is one exclusive policy out of the basic three, and
 * everything else attached is a domain policy. Both go up as one flat list in
 * `PUT /v1/field/iam/users/{id}/policies`.
 *
 * Policy ids are resolved from the tenant's own catalogue by name, never
 * hard-coded. The ids behind the basic roles have already changed once: the
 * `pol_erp_*` trio this screen used to send was deleted platform-side
 * (PLT-3589), which broke inviting and role changes here until this was
 * rewritten. An id that is not in the catalogue is not offered and never sent.
 */

import { i18next } from '../../i18n'

/**
 * Response role identifiers (`ErpRole::as_str` upstream).
 *
 * Renamed from `field:{admin,staff,viewer}` when the roles moved into the
 * platform-defined manifest.
 */
export type ErpRole = 'field:administrator' | 'field:operator' | 'field:reader'

/** Request role identifiers (kebab-case serde variants upstream). */
export type ErpRoleRequest = 'admin' | 'staff' | 'viewer'

export type ErpMember = {
  id: string
  email?: string | null
  name?: string | null
  /** Null for tenant owners (owner access comes from AdministratorAccess). */
  role?: ErpRole | string | null
  isOwner: boolean
  customPolicyIds: string[]
  tenants: string[]
}

export type ErpCustomPolicy = {
  id: string
  name: string
  description?: string | null
}

export type ErpUserListResponse = {
  users: ErpMember[]
  customPolicies: ErpCustomPolicy[]
}

export type InviteMemberResponse = {
  invitationSent: boolean
  email?: string | null
  user?: ErpMember | null
  customPolicyIds: string[]
}

/**
 * The three basic roles, by policy name, with display labels shared with the
 * fieldadmin UI.
 *
 * Names rather than ids: the catalogue is what says which id a name has in
 * this tenant, and the ids are not stable across platform changes.
 *
 * Labels are translation keys, not strings: this array is built once at module
 * load, so baking in the text would pin every role name to whatever language
 * was active on first import and never follow a language switch. Callers
 * translate `labelKey` / `summaryKey` at render time.
 */
export type RoleTextKey = `members:roles.${ErpRoleRequest}.${'label' | 'summary'}`

export const ROLE_OPTIONS: Array<{
  value: ErpRoleRequest
  responseValue: ErpRole
  labelKey: RoleTextKey
  summaryKey: RoleTextKey
}> = [
  {
    value: 'admin',
    responseValue: 'field:administrator',
    labelKey: 'members:roles.admin.label',
    summaryKey: 'members:roles.admin.summary',
  },
  {
    value: 'staff',
    responseValue: 'field:operator',
    labelKey: 'members:roles.staff.label',
    summaryKey: 'members:roles.staff.summary',
  },
  {
    value: 'viewer',
    responseValue: 'field:reader',
    labelKey: 'members:roles.viewer.label',
    summaryKey: 'members:roles.viewer.summary',
  },
]

const ROLE_POLICY_NAMES: readonly string[] = ROLE_OPTIONS.map(option => option.responseValue)
const ADMIN_POLICY_NAME: ErpRole = 'field:administrator'

/**
 * The names the basic roles used to have.
 *
 * Those policies still exist, but frozen and stripped of `auth:*`,
 * `customField:*` and `order:*` — a strictly worse version of the role that
 * replaced them. They stay out of the checklist so nobody grants one by
 * mistake, while a member who still carries one keeps reading correctly.
 */
const RETIRED_POLICY_NAMES: readonly string[] = ['field:admin', 'field:staff', 'field:viewer']

/** The policy id a name has in this tenant, or null when it is not offered. */
export function policyIdByName(
  catalog: ErpCustomPolicy[],
  name: string | null | undefined,
): string | null {
  if (!name) return null
  return catalog.find(policy => policy.name === name)?.id ?? null
}

/** The policy id backing a member's basic role, if the catalogue has it. */
export function rolePolicyId(
  catalog: ErpCustomPolicy[],
  role: ErpRole | string | null | undefined,
): string | null {
  const option = ROLE_OPTIONS.find(candidate => candidate.responseValue === role)
  return option ? policyIdByName(catalog, option.responseValue) : null
}

/**
 * The domain policies to offer: the catalogue minus the basic roles, which are
 * listed separately, and minus the retired names.
 */
export function domainPolicies(catalog: ErpCustomPolicy[]): ErpCustomPolicy[] {
  return catalog.filter(policy =>
    !ROLE_POLICY_NAMES.includes(policy.name) && !RETIRED_POLICY_NAMES.includes(policy.name),
  )
}

/**
 * A member's full policy list: their basic role plus every domain policy.
 *
 * A role whose policy is missing from the catalogue is dropped rather than
 * guessed at — sending an id the tenant cannot see is what the server rejects.
 */
export function memberPolicyIds(
  member: Pick<ErpMember, 'role' | 'customPolicyIds'>,
  catalog: ErpCustomPolicy[],
): string[] {
  const roleId = rolePolicyId(catalog, member.role)
  return roleId ? [roleId, ...member.customPolicyIds] : [...member.customPolicyIds]
}

export function isAdminSelected(catalog: ErpCustomPolicy[], selected: string[]) {
  const adminId = policyIdByName(catalog, ADMIN_POLICY_NAME)
  return adminId !== null && selected.includes(adminId)
}

/**
 * Toggle one policy in a selection while keeping the invariants the API
 * enforces or that make selections meaningless:
 * - the three basic roles are mutually exclusive
 * - the administrator role already covers everything, so selecting it clears
 *   the rest
 */
export function togglePolicySelection(
  catalog: ErpCustomPolicy[],
  selected: string[],
  policyId: string,
  checked: boolean,
): string[] {
  if (!checked) return selected.filter(id => id !== policyId)
  const roleIds = new Set(
    ROLE_POLICY_NAMES.map(name => policyIdByName(catalog, name)).filter(
      (id): id is string => id !== null,
    ),
  )
  if (policyId === policyIdByName(catalog, ADMIN_POLICY_NAME)) return [policyId]
  const next = selected.filter(id =>
    id !== policyId && !(roleIds.has(policyId) && roleIds.has(id)),
  )
  return [...next, policyId]
}

const ROLE_LABEL_KEYS = new Map<string, RoleTextKey>(
  ROLE_OPTIONS.map(option => [option.responseValue, option.labelKey]),
)

/** Resolved per call so the badge follows the active language. */
export function roleLabel(member: Pick<ErpMember, 'role' | 'isOwner'>) {
  if (member.isOwner) return i18next.t('members:roles.owner')
  if (!member.role) return i18next.t('members:roles.unassigned')
  const labelKey = ROLE_LABEL_KEYS.get(member.role)
  return labelKey ? i18next.t(labelKey) : member.role
}

export function roleBadgeVariant(member: Pick<ErpMember, 'role' | 'isOwner'>) {
  if (member.isOwner) return 'accent' as const
  switch (member.role) {
    case 'field:administrator':
      return 'success' as const
    case 'field:operator':
      return 'warning' as const
    default:
      return 'neutral' as const
  }
}

export function rolePermissionSummary(member: Pick<ErpMember, 'role' | 'isOwner'>) {
  if (member.isOwner) return i18next.t('members:roles.ownerSummary')
  const option = ROLE_OPTIONS.find(candidate => candidate.responseValue === member.role)
  if (option) return i18next.t(option.summaryKey)
  return i18next.t('members:roles.unassignedSummary')
}

const ROLE_SORT_ORDER = new Map<string, number>([
  ['field:administrator', 1],
  ['field:operator', 2],
  ['field:reader', 3],
])

function roleSortKey(member: ErpMember) {
  if (member.isOwner) return 0
  if (!member.role) return 9
  return ROLE_SORT_ORDER.get(member.role) ?? 5
}

export function memberDisplayName(member: ErpMember) {
  return member.name || member.email || member.id
}

/** Owner first, then admin → staff → viewer → unassigned, name order within. */
export function sortMembers(members: ErpMember[]): ErpMember[] {
  return [...members].sort((a, b) => {
    const roleDiff = roleSortKey(a) - roleSortKey(b)
    if (roleDiff !== 0) return roleDiff
    return memberDisplayName(a).localeCompare(memberDisplayName(b), 'ja')
  })
}

export function customPolicyNames(
  member: Pick<ErpMember, 'customPolicyIds'>,
  catalog: ErpCustomPolicy[],
): string[] {
  const byId = new Map(catalog.map(policy => [policy.id, policy.name]))
  return member.customPolicyIds.map(id => byId.get(id) ?? id)
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateInviteEmail(raw: string): { email: string } | { error: string } {
  const email = raw.trim().toLowerCase()
  if (!email) return { error: i18next.t('members:invite.validation.emailRequired') }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: i18next.t('members:invite.validation.emailFormat') }
  }
  return { email }
}

/**
 * An existing platform user gets tenant access and the role policies applied
 * immediately (`user` present). A new address only receives an invitation
 * email — role policies cannot be attached until the invitee accepts, so the
 * operator must assign the role afterwards.
 */
export function inviteResultMessage(response: InviteMemberResponse) {
  const email = response.email ?? response.user?.email ?? ''
  if (response.invitationSent) {
    return i18next.t('members:invite.result.sent', {
      email: email || i18next.t('members:invite.result.sentFallback'),
    })
  }
  return i18next.t('members:invite.result.applied', {
    name: response.user?.name || email || i18next.t('members:invite.result.appliedFallback'),
  })
}
