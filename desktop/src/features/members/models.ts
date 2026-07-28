/**
 * Tenant member and permission management backed by the Field IAM surface
 * (`/v1/field/iam/users*`) through the courseboard field proxy. Upstream gates
 * every call with the ERP action `field:ManageUsers` (tenant owners pass via
 * the owner bypass). An ERP role is implemented server-side as an exclusive
 * role policy (`pol_erp_admin` / `pol_erp_staff` / `pol_erp_viewer`) plus any
 * attached custom policies — updating a role replaces those attachments.
 */

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
 */
export const ROLE_OPTIONS: Array<{
  value: ErpRoleRequest
  responseValue: ErpRole
  policyId: string
  label: string
  summary: string
}> = [
  {
    value: 'admin',
    responseValue: 'field:admin',
    policyId: 'pol_erp_admin',
    label: '管理者',
    summary: '全機能の操作に加えて、メンバーと設定も管理できます。ほかのロールを付与する必要はありません。',
  },
  {
    value: 'staff',
    responseValue: 'field:staff',
    policyId: 'pol_erp_staff',
    label: 'スタッフ',
    summary: '日常の業務データを作成・更新できます。メンバー管理と設定変更はできません。',
  },
  {
    value: 'viewer',
    responseValue: 'field:viewer',
    policyId: 'pol_erp_viewer',
    label: '閲覧者',
    summary: '業務データの閲覧のみできます。作成・更新・削除はできません。',
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
 * - 管理者 already covers everything, so selecting it clears the rest
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

const ROLE_LABELS = new Map<string, string>(
  ROLE_OPTIONS.map(option => [option.responseValue, option.label]),
)

export function roleLabel(member: Pick<ErpMember, 'role' | 'isOwner'>) {
  if (member.isOwner) return 'オーナー'
  if (!member.role) return '未割り当て'
  return ROLE_LABELS.get(member.role) ?? member.role
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
  if (member.isOwner) {
    return 'テナントのオーナー。AdministratorAccess により常にすべての操作ができます。'
  }
  const option = ROLE_OPTIONS.find(candidate => candidate.responseValue === member.role)
  if (option) return option.summary
  return 'ロール未割り当て。ロールを割り当てるまで Field の業務データは操作できません。'
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
  if (!email) return { error: 'メールアドレスを入力してください。' }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: 'メールアドレスの形式が正しくありません。' }
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
    return `${email || '指定のアドレス'} 宛に招待メールを送信しました。承諾後にこの画面でロールを割り当ててください。`
  }
  const who = response.user?.name || email || '既存ユーザー'
  return `${who} は既存ユーザーのため、アクセス付与とロール割り当てを直ちに行いました。`
}
