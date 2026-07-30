/**
 * Tenant member and permission management backed by the Field IAM surface
 * (`/v1/field/iam/users*`) through the courseboard field proxy. Upstream gates
 * every call with the ERP action `field:ManageUsers` (tenant owners pass via
 * the owner bypass). An ERP role is implemented server-side as an exclusive
 * role policy (`pol_erp_admin` / `pol_erp_staff` / `pol_erp_viewer`) plus any
 * attached custom policies — updating a role replaces those attachments.
 */

import { i18next } from '../../i18n'

/** Response role identifiers (`ErpRole::as_str` upstream). */
export type ErpRole = 'field:admin' | 'field:staff' | 'field:viewer'

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
 * The three exclusive roles as policies (`pol_erp_*`), with display labels
 * shared with the fieldadmin UI. Roles and domain policies are managed as one
 * flat policy list via `PUT /v1/field/iam/users/{id}/policies`.
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
  policyId: string
  labelKey: RoleTextKey
  summaryKey: RoleTextKey
}> = [
  {
    value: 'admin',
    responseValue: 'field:admin',
    policyId: 'pol_erp_admin',
    labelKey: 'members:roles.admin.label',
    summaryKey: 'members:roles.admin.summary',
  },
  {
    value: 'staff',
    responseValue: 'field:staff',
    policyId: 'pol_erp_staff',
    labelKey: 'members:roles.staff.label',
    summaryKey: 'members:roles.staff.summary',
  },
  {
    value: 'viewer',
    responseValue: 'field:viewer',
    policyId: 'pol_erp_viewer',
    labelKey: 'members:roles.viewer.label',
    summaryKey: 'members:roles.viewer.summary',
  },
]

const ROLE_POLICY_IDS = new Set(ROLE_OPTIONS.map(option => option.policyId))
const ADMIN_POLICY_ID = 'pol_erp_admin'

/** The `pol_erp_*` policy id backing a member's exclusive role, if any. */
export function rolePolicyId(role: ErpRole | string | null | undefined): string | null {
  const option = ROLE_OPTIONS.find(candidate => candidate.responseValue === role)
  return option?.policyId ?? null
}

/** A member's full ERP policy list (exclusive role policy + domain policies). */
export function memberPolicyIds(member: Pick<ErpMember, 'role' | 'customPolicyIds'>): string[] {
  const roleId = rolePolicyId(member.role)
  return roleId ? [roleId, ...member.customPolicyIds] : [...member.customPolicyIds]
}

export function isAdminSelected(selected: string[]) {
  return selected.includes(ADMIN_POLICY_ID)
}

/**
 * Toggle one policy in a selection while keeping the invariants the API
 * enforces or that make selections meaningless:
 * - the three role policies are mutually exclusive
 * - the administrator role already covers everything, so selecting it clears
 *   the rest
 */
export function togglePolicySelection(
  selected: string[],
  policyId: string,
  checked: boolean,
): string[] {
  if (!checked) return selected.filter(id => id !== policyId)
  if (policyId === ADMIN_POLICY_ID) return [ADMIN_POLICY_ID]
  const next = selected.filter(id =>
    id !== policyId && !(ROLE_POLICY_IDS.has(policyId) && ROLE_POLICY_IDS.has(id)),
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
    case 'field:admin':
      return 'success' as const
    case 'field:staff':
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
  ['field:admin', 1],
  ['field:staff', 2],
  ['field:viewer', 3],
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
