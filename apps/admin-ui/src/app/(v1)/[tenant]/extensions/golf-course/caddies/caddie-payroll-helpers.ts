export type CaddiePayrollSummaryRow = {
	caddieProfileId: string
	displayName: string
	staffId?: string | null
	workedMinutes: number
	shiftedMinutes: number
	assignedRounds: number
	confirmedFeeTotal: number
	currency: string
	openClockIn: boolean
	roundsWithoutClockIn: number
}

export type CaddiePayrollPeriod = {
	yearMonth: string
	startDate: string
	endDate: string
}

export type CaddieAttendanceSnapshot = {
	caddieProfileId: string
	displayName: string
	staffId?: string | null
	attendanceStatus: 'not_linked' | 'not_clocked' | 'working' | 'clocked_out'
	todayAssignments: number
	roundsWithoutClockInToday: number
}

export function defaultPayrollYearMonth(now = new Date()): string {
	const year = now.getUTCFullYear()
	const month = now.getUTCMonth()
	const target = month === 0 ? { y: year - 1, m: 12 } : { y: year, m: month }
	return `${target.y}-${String(target.m).padStart(2, '0')}`
}

export function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	return `${hours}h ${rest}m`
}

export function resolveStaffMemberId(profile: {
	staffId?: string | null
	staffReferenceType?: string
	staffReferenceId?: string | null
}): string | null {
	if (profile.staffId) {
		return profile.staffId
	}
	if (
		profile.staffReferenceType === 'staff_member' &&
		profile.staffReferenceId
	) {
		return profile.staffReferenceId
	}
	return null
}

export function isCaddieStaffLinked(profile: {
	staffId?: string | null
	staffReferenceType?: string
	staffReferenceId?: string | null
}): boolean {
	return resolveStaffMemberId(profile) !== null
}

export type CaddieLinkFilter = 'all' | 'linked' | 'unlinked'
export type CaddieEmploymentStatusFilter =
	| 'all'
	| 'active'
	| 'inactive'
	| 'suspended'
export type CaddieSkillFilter = 'all' | 'rookie' | 'regular' | 'veteran'

export function parseCaddieLinkFilter(
	value: string | undefined,
): CaddieLinkFilter {
	if (value === 'linked' || value === 'unlinked') {
		return value
	}
	return 'all'
}

export function filterCaddieProfilesByLink<
	T extends {
		staffId?: string | null
		staffReferenceType?: string
		staffReferenceId?: string | null
	},
>(profiles: T[], filter: CaddieLinkFilter): T[] {
	if (filter === 'linked') {
		return profiles.filter(isCaddieStaffLinked)
	}
	if (filter === 'unlinked') {
		return profiles.filter(profile => !isCaddieStaffLinked(profile))
	}
	return profiles
}

export function parseCaddieEmploymentStatusFilter(
	value: string | undefined,
): CaddieEmploymentStatusFilter {
	if (value === 'active' || value === 'inactive' || value === 'suspended') {
		return value
	}
	return 'all'
}

export function parseCaddieSkillFilter(
	value: string | undefined,
): CaddieSkillFilter {
	if (value === 'rookie' || value === 'regular' || value === 'veteran') {
		return value
	}
	return 'all'
}

export function filterCaddieProfilesByStatusAndSkill<
	T extends {
		employmentStatus?: string
		skillLevel?: string
	},
>(
	profiles: T[],
	statusFilter: CaddieEmploymentStatusFilter,
	skillFilter: CaddieSkillFilter,
): T[] {
	return profiles.filter(profile => {
		const statusMatches =
			statusFilter === 'all' || profile.employmentStatus === statusFilter
		const skillMatches =
			skillFilter === 'all' || profile.skillLevel === skillFilter
		return statusMatches && skillMatches
	})
}
