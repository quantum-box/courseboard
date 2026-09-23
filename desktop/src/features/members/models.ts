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
 *
 * Resolving by name only helps while the names are right. Both halves have to
 * come from upstream: the ids from the tenant's catalogue, the names from
 * Field's auth manifest.
 */

import { i18next } from '../../i18n'

/**
 * Response role identifiers (`ErpRole::as_str` upstream).
 *
 * These are the names Field's own auth manifest defines
 * (`tachyonfield/.tachyon/manifests/tachyonfield-auth.yml`) and the only ones
 * a tenant's catalogue carries. A `field:{administrator,operator,reader}`
 * rename was assumed here once and never happened upstream, which left this
 * screen offering no basic role at all and dropping the one a member already
 * had — see the note on `ROLE_OPTIONS`.
 */
export type ErpRole = 'field:admin' | 'field:staff' | 'field:viewer'

/**
 * Key segments for the basic-role wording. The upstream role request enum
 * (`admin`/`staff`/`viewer`) is no longer sent — everything goes up as
 * `policyIds` — but the i18n keys keep the same short names.
 */
type RoleKeySegment = 'admin' | 'staff' | 'viewer'

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
 * The names themselves are not ours to choose. They are the policy names in
 * Field's auth manifest, and what `role` comes back as on a member. This list
 * briefly held `field:{administrator,operator,reader}` on the belief that the
 * roles had been renamed; upstream never renamed anything, so no name here
 * matched the catalogue. Every basic role vanished from the checklist, and
 * saving a member dropped the role they had — `memberPolicyIds` cannot resolve
 * a name the catalogue lacks, and the save replaces the whole set.
 *
 * Labels are translation keys, not strings: this array is built once at module
 * load, so baking in the text would pin every role name to whatever language
 * was active on first import and never follow a language switch. Callers
 * translate `labelKey` / `summaryKey` at render time.
 */
export type RoleTextKey = `members:roles.${RoleKeySegment}.${'label' | 'summary'}`

export const ROLE_OPTIONS: Array<{
  responseValue: ErpRole
  labelKey: RoleTextKey
  summaryKey: RoleTextKey
}> = [
  {
    responseValue: 'field:admin',
    labelKey: 'members:roles.admin.label',
    summaryKey: 'members:roles.admin.summary',
  },
  {
    responseValue: 'field:staff',
    labelKey: 'members:roles.staff.label',
    summaryKey: 'members:roles.staff.summary',
  },
  {
    responseValue: 'field:viewer',
    labelKey: 'members:roles.viewer.label',
    summaryKey: 'members:roles.viewer.summary',
  },
]

const ROLE_POLICY_NAMES: readonly string[] = ROLE_OPTIONS.map(option => option.responseValue)
const ADMIN_POLICY_NAME: ErpRole = 'field:admin'

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
 * listed separately.
 */
export function domainPolicies(catalog: ErpCustomPolicy[]): ErpCustomPolicy[] {
  return catalog.filter(policy => !ROLE_POLICY_NAMES.includes(policy.name))
}

/**
 * Reader-facing wording for the policies the platform ships in the Field
 * catalogue. The catalogue itself only carries the identifier
 * (`field:reservations`) and an English manifest description, neither of
 * which the person assigning permissions should have to decode. Resolved per
 * call so the text follows the active language; a policy this build has no
 * wording for falls back to its raw name and description, so tenant-defined
 * policies stay recognizable instead of rendering blank.
 */
const POLICY_TEXT: ReadonlyMap<string, { label: () => string; description: () => string }> = new Map([
  ['field:sales', {
    label: () => i18next.t('members:policies.fieldSales.label'),
    description: () => i18next.t('members:policies.fieldSales.description'),
  }],
  ['field:finance', {
    label: () => i18next.t('members:policies.fieldFinance.label'),
    description: () => i18next.t('members:policies.fieldFinance.description'),
  }],
  ['field:procurement', {
    label: () => i18next.t('members:policies.fieldProcurement.label'),
    description: () => i18next.t('members:policies.fieldProcurement.description'),
  }],
  ['field:reservations', {
    label: () => i18next.t('members:policies.fieldReservations.label'),
    description: () => i18next.t('members:policies.fieldReservations.description'),
  }],
  ['field:hr', {
    label: () => i18next.t('members:policies.fieldHr.label'),
    description: () => i18next.t('members:policies.fieldHr.description'),
  }],
  ['field:AccountingManager', {
    label: () => i18next.t('members:policies.fieldAccountingManager.label'),
    description: () => i18next.t('members:policies.fieldAccountingManager.description'),
  }],
  ['field:ExpenseApprover', {
    label: () => i18next.t('members:policies.fieldExpenseApprover.label'),
    description: () => i18next.t('members:policies.fieldExpenseApprover.description'),
  }],
  ['field:PurchaseApprover', {
    label: () => i18next.t('members:policies.fieldPurchaseApprover.label'),
    description: () => i18next.t('members:policies.fieldPurchaseApprover.description'),
  }],
  ['field:ExtensionManager', {
    label: () => i18next.t('members:policies.fieldExtensionManager.label'),
    description: () => i18next.t('members:policies.fieldExtensionManager.description'),
  }],
  ['field:SaasApprover', {
    label: () => i18next.t('members:policies.fieldSaasApprover.label'),
    description: () => i18next.t('members:policies.fieldSaasApprover.description'),
  }],
  // The golf roles this repository defines in
  // `.tachyon/manifests/tachyonfield-golf-auth.yml`.
  ['field-extension:golf:manager', {
    label: () => i18next.t('members:policies.golfManager.label'),
    description: () => i18next.t('members:policies.golfManager.description'),
  }],
  ['field-extension:golf:reception', {
    label: () => i18next.t('members:policies.golfReception.label'),
    description: () => i18next.t('members:policies.golfReception.description'),
  }],
  ['field-extension:golf:caddie-master', {
    label: () => i18next.t('members:policies.golfCaddieMaster.label'),
    description: () => i18next.t('members:policies.golfCaddieMaster.description'),
  }],
  ['field-extension:golf:accounting', {
    label: () => i18next.t('members:policies.golfAccounting.label'),
    description: () => i18next.t('members:policies.golfAccounting.description'),
  }],
  ['field-extension:golf:viewer', {
    label: () => i18next.t('members:policies.golfViewer.label'),
    description: () => i18next.t('members:policies.golfViewer.description'),
  }],
])

/** What the checklist and badges should print for one catalogue policy. */
export function policyDisplay(policy: ErpCustomPolicy): { label: string; description: string | null } {
  // A basic role reaching here is one badged as a plain policy — a pending
  // invitation lists what it asked for as one flat set, with no role resolved
  // yet. It still reads as its role name rather than `field:staff`.
  const role = ROLE_OPTIONS.find(option => option.responseValue === policy.name)
  if (role) return { label: i18next.t(role.labelKey), description: i18next.t(role.summaryKey) }
  const known = POLICY_TEXT.get(policy.name)
  if (!known) return { label: policy.name, description: policy.description ?? null }
  return { label: known.label(), description: known.description() }
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
  const byId = new Map(catalog.map(policy => [policy.id, policy]))
  return member.customPolicyIds.map(id => {
    const policy = byId.get(id)
    return policy ? policyDisplay(policy).label : id
  })
}

/**
 * The strongest selection this catalogue can express. With the administrator
 * role on offer that is just the role itself — it already covers everything,
 * and the checklist invariant clears the rest anyway. Without it, the current
 * basic role is kept and every domain policy is added.
 */
export function selectAllPolicyIds(catalog: ErpCustomPolicy[], selected: string[]): string[] {
  const adminId = policyIdByName(catalog, ADMIN_POLICY_NAME)
  if (adminId) return [adminId]
  const roleIds = new Set(
    ROLE_POLICY_NAMES.map(name => policyIdByName(catalog, name)).filter(
      (id): id is string => id !== null,
    ),
  )
  const role = selected.find(id => roleIds.has(id))
  const domain = domainPolicies(catalog).map(policy => policy.id)
  return role ? [role, ...domain] : domain
}

/** An invitation sent to an address the roster does not know yet. */
export type PendingInvite = { email: string; policyIds: string[] }

/** One roster row: a fetched member, or a locally remembered invitation. */
export type MemberRow = ErpMember & { pending?: boolean }

/**
 * A local roster row for an invitation the list API cannot see. Upstream only
 * returns members who exist as users, so a fresh invitation would otherwise
 * vanish from the screen the moment the list refreshes.
 */
export function pendingMemberRow(invite: PendingInvite): MemberRow {
  return {
    id: `pending:${invite.email}`,
    email: invite.email,
    name: null,
    role: null,
    isOwner: false,
    customPolicyIds: invite.policyIds,
    tenants: [],
    pending: true,
  }
}

/**
 * Invitations still outstanding: an invite stays on screen until its address
 * shows up in the fetched roster, which is the only signal of acceptance the
 * IAM surface offers.
 */
export function remainingPendingInvites(
  pending: PendingInvite[],
  users: ErpMember[],
): PendingInvite[] {
  const emails = new Set(
    users
      .map(user => user.email?.toLowerCase())
      .filter((email): email is string => Boolean(email)),
  )
  return pending.filter(invite => !emails.has(invite.email.toLowerCase()))
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
