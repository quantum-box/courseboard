import type { CaddieAssignment } from './action'

function dayKey(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value.slice(0, 10)
	}
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
		2,
		'0',
	)}-${String(date.getDate()).padStart(2, '0')}`
}

export function buildCaddieDispatchSummary(
	assignments: CaddieAssignment[],
	now = new Date(),
) {
	const todayKey = dayKey(now.toISOString())
	const todayAssignments = assignments.filter(
		assignment => dayKey(assignment.scheduledAt) === todayKey,
	)
	const todayActiveAssignments = todayAssignments.filter(
		assignment => assignment.status !== 'cancelled',
	)
	const unconfirmed = assignments.filter(assignment =>
		['pending', 'requested', 'draft'].includes(assignment.status),
	).length
	const cancelled = assignments.filter(
		assignment => assignment.status === 'cancelled',
	).length
	const absent = assignments.filter(assignment =>
		['absent', 'no_show'].includes(assignment.status),
	).length
	const todayFeeAmount = todayActiveAssignments.reduce(
		(total, assignment) => total + assignment.feeAmount,
		0,
	)

	return {
		today: todayAssignments.length,
		todayAssigned: todayActiveAssignments.filter(
			assignment => assignment.status === 'assigned',
		).length,
		unconfirmed,
		cancelled,
		absent,
		needsCheck: unconfirmed + cancelled + absent,
		todayFeeAmount,
	}
}
