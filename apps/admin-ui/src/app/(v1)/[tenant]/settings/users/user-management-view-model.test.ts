import { describe, expect, it } from 'vitest'
import {
	createPendingInviteRow,
	mergeInviteResult,
	toMemberOnboardingRows,
} from './user-management-view-model'

describe('member onboarding view model', () => {
	it('marks fetched members as active', () => {
		const rows = toMemberOnboardingRows([
			{
				id: 'usr_1',
				email: 'admin@example.com',
				name: 'Admin',
				role: 'field:admin',
				tenants: ['tn_test'],
			},
		])

		expect(rows).toEqual([
			{
				id: 'usr_1',
				email: 'admin@example.com',
				name: 'Admin',
				role: 'field:admin',
				tenants: ['tn_test'],
				status: 'active',
			},
		])
	})

	it('creates a pending row from an invitation sent by the API', () => {
		expect(
			createPendingInviteRow(' New.User@Example.COM ', 'field:staff'),
		).toEqual({
			id: 'pending:new.user@example.com',
			email: 'new.user@example.com',
			name: null,
			role: 'field:staff',
			tenants: [],
			status: 'pending',
		})
	})

	it('replaces a pending invitation when the invited user becomes active', () => {
		const current = [createPendingInviteRow('staff@example.com', 'field:viewer')]
		const rows = mergeInviteResult(current, {
			status: 'active',
			user: {
				id: 'usr_staff',
				email: 'staff@example.com',
				name: 'Staff',
				role: 'field:staff',
				tenants: ['tn_test'],
			},
		})

		expect(rows).toEqual([
			{
				id: 'usr_staff',
				email: 'staff@example.com',
				name: 'Staff',
				role: 'field:staff',
				tenants: ['tn_test'],
				status: 'active',
			},
		])
	})
})
