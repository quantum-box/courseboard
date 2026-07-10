import type { StaffMemberOption } from './action'

export function filterStaffMemberOptions(
	options: StaffMemberOption[],
	query: string,
): StaffMemberOption[] {
	const normalized = query.trim().toLowerCase()
	if (!normalized) {
		return options
	}
	return options.filter(
		option =>
			option.name.toLowerCase().includes(normalized) ||
			option.id.toLowerCase().includes(normalized),
	)
}
