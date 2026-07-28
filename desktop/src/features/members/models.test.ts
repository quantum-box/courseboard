import { describe, expect, it } from 'vitest'
import {
  customPolicyNames,
  inviteResultMessage,
  isAdminSelected,
  memberDisplayName,
  memberPolicyIds,
  roleBadgeVariant,
  roleLabel,
  rolePermissionSummary,
  rolePolicyId,
  sortMembers,
  togglePolicySelection,
  validateInviteEmail,
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

describe('roleLabel', () => {
  it('maps ERP roles to fieldadmin-consistent labels', () => {
    expect(roleLabel(member({ role: 'field:admin' }))).toBe('管理者')
    expect(roleLabel(member({ role: 'field:staff' }))).toBe('スタッフ')
    expect(roleLabel(member({ role: 'field:viewer' }))).toBe('閲覧者')
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
    expect(roleBadgeVariant(member({ role: 'field:admin' }))).toBe('success')
    expect(roleBadgeVariant(member({ role: 'field:staff' }))).toBe('warning')
    expect(roleBadgeVariant(member({ role: 'field:viewer' }))).toBe('neutral')
    expect(roleBadgeVariant(member({ role: null }))).toBe('neutral')
  })
})

describe('rolePermissionSummary', () => {
  it('describes each access level', () => {
    expect(rolePermissionSummary(member({ isOwner: true }))).toContain('AdministratorAccess')
    expect(rolePermissionSummary(member({ role: 'field:admin' }))).toContain('メンバー')
    expect(rolePermissionSummary(member({ role: 'field:viewer' }))).toContain('閲覧')
    expect(rolePermissionSummary(member({ role: null }))).toContain('未割り当て')
  })
})

describe('rolePolicyId / memberPolicyIds', () => {
  it('maps response roles to their pol_erp_* policy ids', () => {
    expect(rolePolicyId('field:admin')).toBe('pol_erp_admin')
    expect(rolePolicyId('field:staff')).toBe('pol_erp_staff')
    expect(rolePolicyId('field:viewer')).toBe('pol_erp_viewer')
    expect(rolePolicyId('field:unknown')).toBeNull()
    expect(rolePolicyId(null)).toBeNull()
  })

  it('builds the flat policy list from a member', () => {
    expect(memberPolicyIds({ role: 'field:staff', customPolicyIds: ['pol_caddie_viewer'] }))
      .toEqual(['pol_erp_staff', 'pol_caddie_viewer'])
    expect(memberPolicyIds({ role: null, customPolicyIds: ['pol_caddie_viewer'] }))
      .toEqual(['pol_caddie_viewer'])
  })
})

describe('togglePolicySelection', () => {
  it('keeps the three role policies mutually exclusive', () => {
    const next = togglePolicySelection(
      ['pol_erp_staff', 'pol_caddie_viewer'],
      'pol_erp_viewer',
      true,
    )
    expect(next).toEqual(['pol_caddie_viewer', 'pol_erp_viewer'])
  })

  it('selecting 管理者 clears every other policy', () => {
    const next = togglePolicySelection(
      ['pol_erp_staff', 'pol_caddie_viewer'],
      'pol_erp_admin',
      true,
    )
    expect(next).toEqual(['pol_erp_admin'])
    expect(isAdminSelected(next)).toBe(true)
  })

  it('toggles domain policies independently', () => {
    const added = togglePolicySelection(['pol_erp_staff'], 'pol_caddie_viewer', true)
    expect(added).toEqual(['pol_erp_staff', 'pol_caddie_viewer'])
    const removed = togglePolicySelection(added, 'pol_caddie_viewer', false)
    expect(removed).toEqual(['pol_erp_staff'])
  })

  it('allows a domain-only selection with no exclusive role', () => {
    const next = togglePolicySelection([], 'pol_caddie_viewer', true)
    expect(next).toEqual(['pol_caddie_viewer'])
    expect(isAdminSelected(next)).toBe(false)
  })
})

describe('sortMembers', () => {
  it('orders owner, admin, staff, viewer, then unassigned', () => {
    const owner = member({ id: 'us_owner', isOwner: true, name: 'Zオーナー' })
    const admin = member({ id: 'us_admin', role: 'field:admin', name: 'A管理者' })
    const staff = member({ id: 'us_staff', role: 'field:staff', name: 'Bスタッフ' })
    const viewer = member({ id: 'us_viewer', role: 'field:viewer', name: 'C閲覧' })
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
      user: member({ name: '既存 花子', role: 'field:staff' }),
      customPolicyIds: [],
    })
    expect(message).toContain('既存 花子')
    expect(message).toContain('ロール割り当て')
  })
})
