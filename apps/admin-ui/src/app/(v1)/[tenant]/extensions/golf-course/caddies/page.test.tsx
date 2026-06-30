import { describe, expect, it } from 'vitest'
import type { CaddieAssignment } from './action'
import { buildCaddieDispatchSummary } from './caddie-dispatch-summary'
import {
	defaultPayrollYearMonth,
	filterCaddieProfilesByStatusAndSkill,
	filterCaddieProfilesByLink,
	formatMinutes,
	isCaddieStaffLinked,
	parseCaddieEmploymentStatusFilter,
	parseCaddieLinkFilter,
	parseCaddieSkillFilter,
	resolveStaffMemberId,
} from './caddie-payroll-helpers'
import { filterStaffMemberOptions } from './caddie-staff-helpers'

const assignment: CaddieAssignment = {
	id: 'assignment_1',
	caddieProfileId: 'caddie_1',
	reservationId: 'reservation_1',
	roundReference: 'ROUND-001',
	scheduledAt: '2026-05-26T09:00:00.000Z',
	status: 'assigned',
	assignmentRole: 'main',
	feeAmount: 12000,
	feeCurrency: 'JPY',
	recommendationScore: 90,
}

describe('golf caddie dispatch summary', () => {
	it('builds mobile-friendly daily dispatch and export metrics', () => {
		expect(
			buildCaddieDispatchSummary(
				[
					assignment,
					{
						...assignment,
						id: 'assignment_pending',
						status: 'pending',
						feeAmount: 10000,
					},
					{
						...assignment,
						id: 'assignment_cancelled',
						status: 'cancelled',
						feeAmount: 8000,
					},
					{
						...assignment,
						id: 'assignment_absent',
						status: 'absent',
						scheduledAt: '2026-05-25T09:00:00.000Z',
						feeAmount: 9000,
					},
				],
				new Date('2026-05-26T00:00:00.000Z'),
			),
		).toMatchObject({
			today: 3,
			todayAssigned: 1,
			unconfirmed: 1,
			cancelled: 1,
			absent: 1,
			needsCheck: 3,
			todayFeeAmount: 22000,
		})
	})
})

describe('golf caddie payroll helpers', () => {
	it('formats worked minutes for payroll tables', () => {
		expect(formatMinutes(125)).toBe('2h 5m')
	})

	it('defaults payroll period to the previous calendar month', () => {
		expect(defaultPayrollYearMonth(new Date('2026-05-15T00:00:00.000Z'))).toBe(
			'2026-04',
		)
	})

	it('resolves staff member id from profile references', () => {
		expect(
			resolveStaffMemberId({
				staffId: 'staff_1',
				staffReferenceType: 'staff_member',
				staffReferenceId: 'staff_legacy',
			}),
		).toBe('staff_1')
		expect(
			resolveStaffMemberId({
				staffReferenceType: 'staff_member',
				staffReferenceId: 'staff_2',
			}),
		).toBe('staff_2')
	})

	it('detects linked vs unlinked caddie profiles', () => {
		expect(
			isCaddieStaffLinked({
				staffReferenceType: 'staff_member',
				staffReferenceId: 'staff_2',
			}),
		).toBe(true)
		expect(
			isCaddieStaffLinked({
				staffReferenceType: 'unlinked',
			}),
		).toBe(false)
	})

	it('parses link filter query values', () => {
		expect(parseCaddieLinkFilter('linked')).toBe('linked')
		expect(parseCaddieLinkFilter('unlinked')).toBe('unlinked')
		expect(parseCaddieLinkFilter('invalid')).toBe('all')
	})

	it('filters caddie profiles by staff link state', () => {
		const profiles = [
			{
				id: 'c1',
				staffReferenceType: 'staff_member',
				staffReferenceId: 'staff_1',
			},
			{ id: 'c2', staffReferenceType: 'unlinked' },
		]
		expect(filterCaddieProfilesByLink(profiles, 'linked')).toHaveLength(1)
		expect(filterCaddieProfilesByLink(profiles, 'unlinked')).toHaveLength(1)
		expect(filterCaddieProfilesByLink(profiles, 'all')).toHaveLength(2)
	})

	it('parses and applies caddie profile status and skill filters', () => {
		expect(parseCaddieEmploymentStatusFilter('active')).toBe('active')
		expect(parseCaddieEmploymentStatusFilter('invalid')).toBe('all')
		expect(parseCaddieSkillFilter('veteran')).toBe('veteran')
		expect(parseCaddieSkillFilter('invalid')).toBe('all')

		const profiles = [
			{ employmentStatus: 'active', skillLevel: 'rookie' },
			{ employmentStatus: 'inactive', skillLevel: 'regular' },
			{ employmentStatus: 'active', skillLevel: 'veteran' },
		]
		expect(
			filterCaddieProfilesByStatusAndSkill(profiles, 'active', 'all'),
		).toHaveLength(2)
		expect(
			filterCaddieProfilesByStatusAndSkill(profiles, 'active', 'veteran'),
		).toHaveLength(1)
	})

	it('filters staff member options by name or id', () => {
		const options = [
			{ id: 'staff_abc', name: 'Tanaka', active: true },
			{ id: 'staff_xyz', name: 'Suzuki', active: true },
		]
		expect(filterStaffMemberOptions(options, 'tan')).toHaveLength(1)
		expect(filterStaffMemberOptions(options, 'xyz')).toHaveLength(1)
		expect(filterStaffMemberOptions(options, '')).toHaveLength(2)
	})
})
