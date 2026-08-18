import { describe, expect, it } from 'vitest'
import {
  customPolicyNames,
  domainPolicies,
  inviteResultMessage,
  isAdminSelected,
  memberDisplayName,
  memberPolicyIds,
  pendingMemberRow,
  policyDisplay,
  policyIdByName,
  remainingPendingInvites,
  roleBadgeVariant,
  roleLabel,
  rolePermissionSummary,
  rolePolicyId,
  selectAllPolicyIds,
  sortMembers,
  togglePolicySelection,
  validateInviteEmail,
  type ErpCustomPolicy,
  type ErpMember,
} from './models'

function member(overrides: Partial<ErpMember>): ErpMember {
  return {
    id: 'us_1',
    email: 'user@example.com',
    name: null,
    role: null,
    isOwner: false,
    customPolicyIds: [],
    tenants: ['tenant_1'],
    ...overrides,
  }
}

/**
 * What the tenant can see: the three basic roles, one domain policy, and the
 * retired names that are still in the catalogue but must never be offered.
 */
const CATALOG: ErpCustomPolicy[] = [
  { id: 'pol_admin_new', name: 'field:administrator', description: '管理者' },
  { id: 'pol_operator_new', name: 'field:operator', description: 'スタッフ' },
  { id: 'pol_reader_new', name: 'field:reader', description: '閲覧者' },
  { id: 'pol_reservations', name: 'field:reservations', description: '予約担当' },
  { id: 'pol_old_admin', name: 'field:admin', description: '旧・管理者' },
  { id: 'pol_old_staff', name: 'field:staff', description: '旧・スタッフ' },
  { id: 'pol_old_viewer', name: 'field:viewer', description: '旧・閲覧者' },
]

describe('roleLabel', () => {
  it('maps ERP roles to fieldadmin-consistent labels', () => {
    expect(roleLabel(member({ role: 'field:administrator' }))).toBe('管理者')
    expect(roleLabel(member({ role: 'field:operator' }))).toBe('スタッフ')
    expect(roleLabel(member({ role: 'field:reader' }))).toBe('閲覧者')
  })

  it('labels owners and unassigned members', () => {
    expect(roleLabel(member({ isOwner: true }))).toBe('オーナー')
    expect(roleLabel(member({ role: null }))).toBe('未割り当て')
    expect(roleLabel(member({ role: 'field:custom' }))).toBe('field:custom')
  })
})

describe('roleBadgeVariant', () => {
  it('distinguishes owner and admin from other members', () => {
    expect(roleBadgeVariant(member({ isOwner: true }))).toBe('accent')
    expect(roleBadgeVariant(member({ role: 'field:administrator' }))).toBe('success')
    expect(roleBadgeVariant(member({ role: 'field:operator' }))).toBe('warning')
    expect(roleBadgeVariant(member({ role: 'field:reader' }))).toBe('neutral')
    expect(roleBadgeVariant(member({ role: null }))).toBe('neutral')
  })
})

describe('rolePermissionSummary', () => {
  it('describes each access level', () => {
    expect(rolePermissionSummary(member({ isOwner: true }))).toContain('AdministratorAccess')
    expect(rolePermissionSummary(member({ role: 'field:administrator' }))).toContain('メンバー')
    expect(rolePermissionSummary(member({ role: 'field:reader' }))).toContain('閲覧')
    expect(rolePermissionSummary(member({ role: null }))).toContain('未割り当て')
  })
})

describe('policyIdByName / rolePolicyId', () => {
  it('resolves ids from the tenant catalogue rather than a constant', () => {
    expect(rolePolicyId(CATALOG, 'field:administrator')).toBe('pol_admin_new')
    expect(rolePolicyId(CATALOG, 'field:operator')).toBe('pol_operator_new')
    expect(rolePolicyId(CATALOG, 'field:reader')).toBe('pol_reader_new')
    expect(rolePolicyId(CATALOG, 'field:unknown')).toBeNull()
    expect(rolePolicyId(CATALOG, null)).toBeNull()
  })

  it('answers null for a role this tenant cannot see', () => {
    // This is what broke: the id was a constant, so a policy that had been
    // deleted platform-side was still sent and rejected.
    expect(rolePolicyId([], 'field:operator')).toBeNull()
    expect(policyIdByName([], 'field:operator')).toBeNull()
  })
})

describe('domainPolicies', () => {
  it('leaves out the basic roles, which are listed separately', () => {
    expect(domainPolicies(CATALOG).map(policy => policy.id)).toEqual(['pol_reservations'])
  })

  it('leaves out the retired names, which grant strictly less', () => {
    const names = domainPolicies(CATALOG).map(policy => policy.name)
    expect(names).not.toContain('field:admin')
    expect(names).not.toContain('field:staff')
    expect(names).not.toContain('field:viewer')
  })
})

describe('memberPolicyIds', () => {
  it('builds the flat policy list from a member', () => {
    expect(memberPolicyIds(
      { role: 'field:operator', customPolicyIds: ['pol_reservations'] },
      CATALOG,
    )).toEqual(['pol_operator_new', 'pol_reservations'])
    expect(memberPolicyIds({ role: null, customPolicyIds: ['pol_reservations'] }, CATALOG))
      .toEqual(['pol_reservations'])
  })

  it('drops a role the catalogue no longer has instead of sending a dead id', () => {
    expect(memberPolicyIds(
      { role: 'field:operator', customPolicyIds: ['pol_reservations'] },
      [],
    )).toEqual(['pol_reservations'])
  })
})

describe('togglePolicySelection', () => {
  it('keeps the three basic roles mutually exclusive', () => {
    const next = togglePolicySelection(
      CATALOG,
      ['pol_operator_new', 'pol_reservations'],
      'pol_reader_new',
      true,
    )
    expect(next).toEqual(['pol_reservations', 'pol_reader_new'])
  })

  it('selecting 管理者 clears every other policy', () => {
    const next = togglePolicySelection(
      CATALOG,
      ['pol_operator_new', 'pol_reservations'],
      'pol_admin_new',
      true,
    )
    expect(next).toEqual(['pol_admin_new'])
    expect(isAdminSelected(CATALOG, next)).toBe(true)
  })

  it('toggles domain policies independently', () => {
    const added = togglePolicySelection(CATALOG, ['pol_operator_new'], 'pol_reservations', true)
    expect(added).toEqual(['pol_operator_new', 'pol_reservations'])
    const removed = togglePolicySelection(CATALOG, added, 'pol_reservations', false)
    expect(removed).toEqual(['pol_operator_new'])
  })

  it('allows a domain-only selection with no basic role', () => {
    const next = togglePolicySelection(CATALOG, [], 'pol_reservations', true)
    expect(next).toEqual(['pol_reservations'])
    expect(isAdminSelected(CATALOG, next)).toBe(false)
  })

  it('does not treat an unknown id as the administrator role', () => {
    expect(isAdminSelected([], ['pol_admin_new'])).toBe(false)
  })
})

describe('sortMembers', () => {
  it('orders owner, admin, staff, viewer, then unassigned', () => {
    const owner = member({ id: 'us_owner', isOwner: true, name: 'Zオーナー' })
    const admin = member({ id: 'us_admin', role: 'field:administrator', name: 'A管理者' })
    const staff = member({ id: 'us_staff', role: 'field:operator', name: 'Bスタッフ' })
    const viewer = member({ id: 'us_viewer', role: 'field:reader', name: 'C閲覧' })
    const none = member({ id: 'us_none', role: null, name: 'D未割当' })
    const sorted = sortMembers([none, viewer, staff, admin, owner])
    expect(sorted.map(entry => entry.id)).toEqual([
      'us_owner',
      'us_admin',
      'us_staff',
      'us_viewer',
      'us_none',
    ])
  })
})

describe('memberDisplayName', () => {
  it('falls back from name to email to id', () => {
    expect(memberDisplayName(member({ name: '山田 太郎' }))).toBe('山田 太郎')
    expect(memberDisplayName(member({ name: null }))).toBe('user@example.com')
    expect(memberDisplayName(member({ name: null, email: null }))).toBe('us_1')
  })
})

describe('customPolicyNames', () => {
  it('resolves ids to catalog names with id fallback', () => {
    const catalog = [
      { id: 'pol_1', name: '予約担当', description: null },
      { id: 'pol_2', name: '経理担当' },
    ]
    expect(
      customPolicyNames(member({ customPolicyIds: ['pol_1', 'pol_2', 'pol_x'] }), catalog),
    ).toEqual(['予約担当', '経理担当', 'pol_x'])
  })

  it('renders a platform policy through its screen wording', () => {
    expect(
      customPolicyNames(member({ customPolicyIds: ['pol_reservations'] }), CATALOG),
    ).toEqual(['予約管理'])
  })
})

describe('policyDisplay', () => {
  it('replaces manifest identifiers with screen wording', () => {
    const display = policyDisplay({
      id: 'pol_reservations',
      name: 'field:reservations',
      description: 'Manage reservations, resources, and plans',
    })
    expect(display.label).toBe('予約管理')
    expect(display.description).toContain('予約')
  })

  it('reads a basic role by its role name, which is how a pending invite lists it', () => {
    expect(policyDisplay({ id: 'pol_operator_new', name: 'field:operator' }).label).toBe('スタッフ')
  })

  it('falls back to the raw name and description for unknown policies', () => {
    expect(policyDisplay({ id: 'pol_x', name: 'キャディ管理', description: '説明文' }))
      .toEqual({ label: 'キャディ管理', description: '説明文' })
    expect(policyDisplay({ id: 'pol_y', name: 'field:something-new' }))
      .toEqual({ label: 'field:something-new', description: null })
  })
})

describe('selectAllPolicyIds', () => {
  it('collapses to the administrator role, which already covers everything', () => {
    expect(selectAllPolicyIds(CATALOG, ['pol_operator_new', 'pol_reservations']))
      .toEqual(['pol_admin_new'])
  })

  it('keeps the current role and adds every domain policy without an administrator entry', () => {
    const catalog = CATALOG.filter(policy => policy.name !== 'field:administrator')
    expect(selectAllPolicyIds(catalog, ['pol_operator_new']))
      .toEqual(['pol_operator_new', 'pol_reservations'])
    expect(selectAllPolicyIds(catalog, [])).toEqual(['pol_reservations'])
  })
})

describe('pending invites', () => {
  it('builds a read-only roster row for a fresh invitation', () => {
    const row = pendingMemberRow({ email: 'new@example.com', policyIds: ['pol_reservations'] })
    expect(row.id).toBe('pending:new@example.com')
    expect(row.pending).toBe(true)
    expect(row.isOwner).toBe(false)
    expect(row.customPolicyIds).toEqual(['pol_reservations'])
  })

  it('keeps an invite only until its address appears in the roster', () => {
    const pending = [
      { email: 'new@example.com', policyIds: [] },
      { email: 'accepted@example.com', policyIds: [] },
    ]
    const users = [member({ id: 'us_a', email: 'Accepted@Example.com' })]
    expect(remainingPendingInvites(pending, users))
      .toEqual([{ email: 'new@example.com', policyIds: [] }])
  })
})

describe('validateInviteEmail', () => {
  it('accepts and normalizes a valid email', () => {
    expect(validateInviteEmail('  Staff@Example.com ')).toEqual({ email: 'staff@example.com' })
  })

  it('rejects empty and malformed input', () => {
    expect(validateInviteEmail('')).toHaveProperty('error')
    expect(validateInviteEmail('   ')).toHaveProperty('error')
    expect(validateInviteEmail('not-an-email')).toHaveProperty('error')
    expect(validateInviteEmail('a@b')).toHaveProperty('error')
  })
})

describe('inviteResultMessage', () => {
  it('asks the operator to assign the role after acceptance for new invitees', () => {
    const message = inviteResultMessage({
      invitationSent: true,
      email: 'new@example.com',
      user: null,
      customPolicyIds: [],
    })
    expect(message).toContain('new@example.com')
    expect(message).toContain('招待メール')
    expect(message).toContain('ロールを割り当て')
  })

  it('describes immediate access and role assignment for existing users', () => {
    const message = inviteResultMessage({
      invitationSent: false,
      email: 'existing@example.com',
      user: member({ name: '既存 花子', role: 'field:operator' }),
      customPolicyIds: [],
    })
    expect(message).toContain('既存 花子')
    expect(message).toContain('ロール割り当て')
  })
})
