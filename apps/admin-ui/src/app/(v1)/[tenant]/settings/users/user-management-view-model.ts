import type { ErpRole, ErpUser, InviteErpUserResult } from './actions'

export type MemberOnboardingStatus = 'active' | 'pending'

export type MemberOnboardingRow = ErpUser & {
	status: MemberOnboardingStatus
}

export const roles: Array<{ value: ErpRole; label: string }> = [
	{ value: 'field:admin', label: '管理者' },
	{ value: 'field:staff', label: 'スタッフ' },
	{ value: 'field:viewer', label: '閲覧者' },
]

export const roleLabels = new Map(roles.map(role => [role.value, role.label]))

export const statusLabels: Record<MemberOnboardingStatus, string> = {
	active: '参加済み',
	pending: '招待中',
}

export function toMemberOnboardingRows(
	users: ErpUser[],
): MemberOnboardingRow[] {
	return users.map(user => ({
		...user,
		status: 'active',
	}))
}

export function createPendingInviteRow(
	email: string,
	role: ErpRole,
): MemberOnboardingRow {
	const normalizedEmail = email.trim().toLowerCase()
	return {
		id: `pending:${normalizedEmail}`,
		email: normalizedEmail,
		name: null,
		role,
		tenants: [],
		status: 'pending',
	}
}

export function mergeInviteResult(
	current: MemberOnboardingRow[],
	result: InviteErpUserResult,
): MemberOnboardingRow[] {
	const nextRow =
		result.status === 'active'
			? ({ ...result.user, status: 'active' } satisfies MemberOnboardingRow)
			: createPendingInviteRow(result.email, result.role)

	const nextEmail = nextRow.email?.toLowerCase() ?? null
	const existingIndex = current.findIndex(row => {
		if (row.id === nextRow.id) {
			return true
		}
		return nextEmail !== null && row.email?.toLowerCase() === nextEmail
	})

	if (existingIndex === -1) {
		return [nextRow, ...current]
	}

	return current.map((row, index) => (index === existingIndex ? nextRow : row))
}
