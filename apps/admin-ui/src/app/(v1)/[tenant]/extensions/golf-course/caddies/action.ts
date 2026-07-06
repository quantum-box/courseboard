'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
import { revalidatePath } from 'next/cache'
import type {
	CaddieAttendanceSnapshot,
	CaddiePayrollPeriod,
	CaddiePayrollSummaryRow,
} from './caddie-payroll-helpers'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type CaddieProfile = {
	id: string
	displayName: string
	staffId?: string | null
	staffReferenceType: string
	staffReferenceId?: string | null
	active?: boolean
	skillLevel: 'rookie' | 'regular' | 'veteran'
	// T02: ランク拡張
	rank: 'A' | 'B' | 'C' | 'D'
	monthlyContractRounds: number
	canTwoRounds: boolean
	desiredIncome: number
	employmentStatus: string
	baseFeeAmount: number
	currency: string
	maxRoundsPerDay: number
	ratingAverage?: number | null
	ratingCount: number
}

export type CaddieAssignment = {
	id: string
	caddieProfileId: string
	reservationId?: string | null
	roundReference?: string | null
	scheduledAt: string
	status: string
	assignmentRole: string
	feeAmount: number
	feeCurrency: string
	recommendationScore?: number | null
	nominatedBy?: string | null
	notes?: string | null
	metadataJson?: unknown
	createdAt?: string
	updatedAt?: string
}

export type CaddieRecommendation = {
	caddieProfileId: string
	displayName: string
	skillLevel: string
	ratingAverage?: number | null
	ratingCount: number
	roundsAssigned: number
	recommendationScore: number
	recommendedRole: string
	pairingDisplayName?: string | null
	rationale: string[]
}

export type CaddieRating = {
	id: string
	caddieProfileId: string
	assignmentId?: string | null
	reservationId?: string | null
	customerId: string
	score: number
	comment?: string | null
	createdAt: string
	updatedAt: string
}

function caddiePath(tenant: string) {
	return `/${tenant}/extensions/golf-course/caddies`
}

function caddieDetailPath(tenant: string, caddieProfileId: string) {
	return `${caddiePath(tenant)}/${caddieProfileId}`
}

async function golfHeaders(tenant: string) {
	const session = await authWithCheck()
	return {
		'Content-Type': 'application/json',
		'x-platform-id': PLATFORM_ID,
		'x-operator-id': tenant,
		Authorization: `Bearer ${session.accessToken}`,
	}
}

async function golfFetchJson<T>(path: string, tenant: string) {
	const result = await fetchJsonWithRetry<T>(joinServerBackendPath(path), {
		headers: await golfHeaders(tenant),
	})
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	return { success: true as const, data: result.data }
}

async function golfFetch(path: string, tenant: string, init?: RequestInit) {
	return fetchWithRetry(joinServerBackendPath(path), {
		...init,
		headers: {
			...(await golfHeaders(tenant)),
			...(init?.headers ?? {}),
		},
	})
}

export async function fetchCaddieProfilesAction(tenant: string) {
	const result = await golfFetchJson<{ items: CaddieProfile[] }>(
		'/v1/erp/extensions/golf-course/caddie-profiles',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchCaddieAssignmentsAction(tenant: string) {
	const result = await golfFetchJson<{ items: CaddieAssignment[] }>(
		'/v1/erp/extensions/golf-course/caddie-assignments',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchCaddieAssignmentsForProfileAction(
	tenant: string,
	caddieProfileId: string,
) {
	const result = await golfFetchJson<{ items: CaddieAssignment[] }>(
		`/v1/erp/extensions/golf-course/caddie-assignments?caddieProfileId=${encodeURIComponent(caddieProfileId)}`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchCaddieProfileAction(
	tenant: string,
	caddieProfileId: string,
) {
	const result = await fetchCaddieProfilesAction(tenant)
	if (!result.success) {
		return result
	}
	const profile = result.data.find(item => item.id === caddieProfileId)
	if (!profile) {
		return { success: false as const, message: 'Caddie profile not found.' }
	}
	return { success: true as const, data: profile }
}

export async function fetchCaddieRatingsAction(
	tenant: string,
	caddieProfileId: string,
) {
	const result = await golfFetchJson<{ items: CaddieRating[] }>(
		`/v1/erp/extensions/golf-course/caddie-ratings?caddieProfileId=${encodeURIComponent(caddieProfileId)}`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchCaddieRecommendationsAction(tenant: string) {
	const result = await golfFetchJson<{ items: CaddieRecommendation[] }>(
		'/v1/erp/extensions/golf-course/caddie-recommendations?playerCount=4&includeRookiePairing=true&limit=5',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchCaddiePayrollSummaryAction(
	tenant: string,
	yearMonth: string,
) {
	const result = await golfFetchJson<{
		period: CaddiePayrollPeriod
		items: CaddiePayrollSummaryRow[]
	}>(
		`/v1/erp/extensions/golf-course/caddie-payroll-summary?yearMonth=${encodeURIComponent(yearMonth)}`,
		tenant,
	)
	return result
}

export async function fetchCaddieAttendanceSnapshotAction(
	tenant: string,
	date?: string,
) {
	const query = date ? `?date=${encodeURIComponent(date)}` : ''
	const result = await golfFetchJson<{
		date: string
		items: CaddieAttendanceSnapshot[]
	}>(
		`/v1/erp/extensions/golf-course/caddie-attendance-snapshot${query}`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function downloadCaddiePayrollCsvAction(
	tenant: string,
	yearMonth: string,
) {
	const response = await golfFetch(
		`/v1/erp/extensions/golf-course/caddie-payroll-summary/export.csv?yearMonth=${encodeURIComponent(yearMonth)}`,
		tenant,
	)
	if (!response.ok) {
		return {
			success: false as const,
			message: response.error.message,
		}
	}
	const csv = await response.response.text()
	return {
		success: true as const,
		csv,
		filename: `caddie-payroll-${yearMonth}.csv`,
	}
}

export async function clockInCaddieStaffAction(
	tenant: string,
	staffId: string,
) {
	const response = await golfFetch(
		`/v1/erp/staff/${staffId}/clock-in`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({}),
		},
	)
	if (!response.ok) {
		throw new Error(response.error.message)
	}
	revalidatePath(caddiePath(tenant))
}

export async function clockOutCaddieStaffAction(
	tenant: string,
	staffId: string,
) {
	const response = await golfFetch(
		`/v1/erp/staff/${staffId}/clock-out`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({ breakMinutes: 0 }),
		},
	)
	if (!response.ok) {
		throw new Error(response.error.message)
	}
	revalidatePath(caddiePath(tenant))
}

export type StaffMemberOption = {
	id: string
	name: string
	active: boolean
}

export async function fetchStaffMemberOptionsAction(tenant: string) {
	const result = await golfFetchJson<{
		items: Array<{ id: string; name: string; active: boolean }>
	}>('/v1/erp/staff', tenant)
	return result.success
		? {
				success: true as const,
				data: result.data.items
					.filter(item => item.active)
					.map(item => ({
						id: item.id,
						name: item.name,
						active: item.active,
					}))
					.sort((left, right) => left.name.localeCompare(right.name, 'ja')),
			}
		: result
}

export async function linkCaddieStaffMemberAction(
	tenant: string,
	caddieProfileId: string,
	staffMemberId: string,
) {
	const profilesResult = await fetchCaddieProfilesAction(tenant)
	if (!profilesResult.success) {
		return profilesResult
	}
	const profile = profilesResult.data.find(item => item.id === caddieProfileId)
	if (!profile) {
		return { success: false as const, message: 'Caddie profile not found.' }
	}

	const response = await golfFetch(
		`/v1/erp/extensions/golf-course/caddie-profiles/${encodeURIComponent(caddieProfileId)}`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				staffId: staffMemberId,
				caddieCode: null,
				staffReferenceType: 'staff_member',
				staffReferenceId: staffMemberId,
				displayName: profile.displayName,
				skillLevel: profile.skillLevel,
				active: profile.active ?? true,
				employmentStatus: profile.employmentStatus,
				baseFeeAmount: profile.baseFeeAmount,
				currency: profile.currency,
				maxRoundsPerDay: profile.maxRoundsPerDay,
			}),
		},
	)
	if (!response.ok) {
		return { success: false as const, message: response.error.message }
	}
	revalidatePath(caddiePath(tenant))
	return { success: true as const }
}

export async function updateCaddieProfileAction(
	tenant: string,
	caddieProfileId: string,
	input: {
		displayName: string
		skillLevel: CaddieProfile['skillLevel']
		employmentStatus: string
		baseFeeAmount: number
		currency: string
		maxRoundsPerDay: number
	},
) {
	const profilesResult = await fetchCaddieProfilesAction(tenant)
	if (!profilesResult.success) {
		return profilesResult
	}
	const profile = profilesResult.data.find(item => item.id === caddieProfileId)
	if (!profile) {
		return { success: false as const, message: 'Caddie profile not found.' }
	}
	if (!input.displayName.trim()) {
		return { success: false as const, message: 'Display name is required.' }
	}
	if (input.baseFeeAmount < 0) {
		return {
			success: false as const,
			message: 'Base fee must be non-negative.',
		}
	}
	if (input.maxRoundsPerDay < 1) {
		return {
			success: false as const,
			message: 'Max rounds per day must be at least 1.',
		}
	}

	const response = await golfFetch(
		`/v1/erp/extensions/golf-course/caddie-profiles/${encodeURIComponent(caddieProfileId)}`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				staffId: profile.staffId ?? profile.staffReferenceId ?? null,
				caddieCode: null,
				staffReferenceType: profile.staffReferenceType,
				staffReferenceId: profile.staffReferenceId ?? profile.staffId ?? null,
				displayName: input.displayName.trim(),
				skillLevel: input.skillLevel,
				active: input.employmentStatus === 'active',
				employmentStatus: input.employmentStatus,
				baseFeeAmount: input.baseFeeAmount,
				currency: input.currency.trim() || profile.currency,
				maxRoundsPerDay: input.maxRoundsPerDay,
			}),
		},
	)
	if (!response.ok) {
		return { success: false as const, message: response.error.message }
	}
	revalidatePath(caddiePath(tenant))
	revalidatePath(caddieDetailPath(tenant, caddieProfileId))
	return { success: true as const }
}

export async function updateCaddieProfileFromFormAction(
	tenant: string,
	caddieProfileId: string,
	formData: FormData,
) {
	const skillLevel = String(formData.get('skillLevel') ?? 'regular')
	const employmentStatus = String(formData.get('employmentStatus') ?? 'active')
	const result = await updateCaddieProfileAction(tenant, caddieProfileId, {
		displayName: String(formData.get('displayName') ?? ''),
		skillLevel:
			skillLevel === 'rookie' ||
			skillLevel === 'regular' ||
			skillLevel === 'veteran'
				? skillLevel
				: 'regular',
		employmentStatus,
		baseFeeAmount: Number(formData.get('baseFeeAmount') ?? 0),
		currency: String(formData.get('currency') ?? 'JPY'),
		maxRoundsPerDay: Number(formData.get('maxRoundsPerDay') ?? 1),
	})
	if (!result.success) {
		throw new Error(result.message)
	}
}

export async function updateAssignmentStatusAction(
	tenant: string,
	assignmentId: string,
	status: 'completed' | 'cancelled',
) {
	const assignmentsResult = await fetchCaddieAssignmentsAction(tenant)
	if (!assignmentsResult.success) {
		return assignmentsResult
	}
	const assignment = assignmentsResult.data.find(
		item => item.id === assignmentId,
	)
	if (!assignment) {
		return { success: false as const, message: 'Caddie assignment not found.' }
	}
	const response = await golfFetch(
		`/v1/erp/extensions/golf-course/caddie-assignments/${encodeURIComponent(assignmentId)}`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				caddieProfileId: assignment.caddieProfileId,
				reservationId: assignment.reservationId ?? null,
				roundReference: assignment.roundReference ?? null,
				scheduledAt: assignment.scheduledAt,
				status,
				assignmentRole: assignment.assignmentRole,
				feeAmount: assignment.feeAmount,
				feeCurrency: assignment.feeCurrency,
				recommendationScore: assignment.recommendationScore ?? null,
				notes: assignment.notes ?? null,
				metadataJson: assignment.metadataJson ?? null,
			}),
		},
	)
	if (!response.ok) {
		return { success: false as const, message: response.error.message }
	}
	revalidatePath(caddiePath(tenant))
	revalidatePath(caddieDetailPath(tenant, assignment.caddieProfileId))
	return { success: true as const }
}

export async function updateAssignmentStatusFromFormAction(
	tenant: string,
	assignmentId: string,
	status: 'completed' | 'cancelled',
) {
	const result = await updateAssignmentStatusAction(
		tenant,
		assignmentId,
		status,
	)
	if (!result.success) {
		throw new Error(result.message)
	}
}

export async function createStaffMemberAction(tenant: string, name: string) {
	const response = await golfFetch('/v1/erp/staff', tenant, {
		method: 'POST',
		body: JSON.stringify({
			name,
			employmentType: 'part_time',
			active: true,
		}),
	})
	if (!response.ok) {
		return { success: false as const, message: response.error.message }
	}
	const staff = (await response.response.json()) as { id: string }
	return { success: true as const, staffMemberId: staff.id }
}

export async function createCaddieProfileAction(
	tenant: string,
	input: {
		displayName: string
		skillLevel: CaddieProfile['skillLevel']
		rank?: CaddieProfile['rank']
		baseFeeAmount: number
		staffMemberId: string
	},
) {
	const response = await golfFetch(
		'/v1/erp/extensions/golf-course/caddie-profiles',
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({
				displayName: input.displayName,
				skillLevel: input.skillLevel,
				rank: input.rank ?? 'D',
				baseFeeAmount: input.baseFeeAmount,
				currency: 'JPY',
				staffId: input.staffMemberId,
				staffReferenceType: 'staff_member',
				staffReferenceId: input.staffMemberId,
				active: true,
				employmentStatus: 'active',
				maxRoundsPerDay: 2,
			}),
		},
	)
	if (!response.ok) {
		return { success: false as const, message: response.error.message }
	}
	revalidatePath(caddiePath(tenant))
	return { success: true as const }
}

export async function createCaddieWithStaffAction(
	tenant: string,
	input: {
		displayName: string
		skillLevel: CaddieProfile['skillLevel']
		rank?: CaddieProfile['rank']
		baseFeeAmount: number
		staffMemberId?: string
		newStaffMemberName?: string
	},
) {
	if (!input.displayName.trim()) {
		return { success: false as const, message: 'Display name is required.' }
	}
	if (input.baseFeeAmount < 0) {
		return {
			success: false as const,
			message: 'Base fee must be non-negative.',
		}
	}

	let staffMemberId = input.staffMemberId?.trim() ?? ''
	if (!staffMemberId && input.newStaffMemberName?.trim()) {
		const staffResult = await createStaffMemberAction(
			tenant,
			input.newStaffMemberName.trim(),
		)
		if (!staffResult.success) {
			return staffResult
		}
		staffMemberId = staffResult.staffMemberId
	}
	if (!staffMemberId) {
		return {
			success: false as const,
			message: 'Select or create a staff member.',
		}
	}

	return createCaddieProfileAction(tenant, {
		displayName: input.displayName.trim(),
		skillLevel: input.skillLevel,
		rank: input.rank,
		baseFeeAmount: input.baseFeeAmount,
		staffMemberId,
	})
}

// --- T03: キャディ対応コース ---

export type CaddieCourseMembership = {
	id: string
	caddieProfileId: string
	golfCourseId: string
	isPrimary: boolean
}

export async function fetchCaddieCourseMembershipsAction(
	tenant: string,
	caddieProfileId: string,
) {
	const result = await golfFetchJson<{ items: CaddieCourseMembership[] }>(
		`/v1/erp/extensions/golf-course/caddie-profiles/${encodeURIComponent(caddieProfileId)}/courses`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function replaceCaddieCourseMembershipsAction(
	tenant: string,
	caddieProfileId: string,
	courseIds: string[],
	primaryCourseId?: string,
) {
	const result = await golfFetch(
		`/v1/erp/extensions/golf-course/caddie-profiles/${encodeURIComponent(caddieProfileId)}/courses`,
		tenant,
		{
			method: 'PUT',
			body: JSON.stringify({
				courseIds,
				primaryCourseId: primaryCourseId ?? null,
			}),
		},
	)
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	revalidatePath(`/${tenant}/extensions/golf-course/caddies/${caddieProfileId}`)
	return { success: true as const }
}

// --- T04: キャディ希望休・体調 ---

export type CaddieAvailabilityStatus =
	| 'available'
	| 'unavailable'
	| 'morning_only'
	| 'afternoon_only'
	| 'light_duty'

export type CaddieAvailabilityRecord = {
	id: string
	caddieProfileId: string
	date: string
	status: CaddieAvailabilityStatus
	twoRoundRequest: boolean
	healthNote?: string | null
	updatedAt: string
}

export async function fetchCaddieAvailabilitiesAction(
	tenant: string,
	caddieProfileId: string,
	from: string,
	to: string,
) {
	const path = `/v1/erp/extensions/golf-course/caddie-availabilities?caddieProfileId=${encodeURIComponent(caddieProfileId)}&from=${from}&to=${to}`
	const result = await golfFetchJson<{ items: CaddieAvailabilityRecord[] }>(
		path,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function upsertCaddieAvailabilityAction(
	tenant: string,
	caddieProfileId: string,
	date: string,
	status: CaddieAvailabilityStatus,
	twoRoundRequest: boolean,
	healthNote?: string,
) {
	const result = await golfFetch(
		'/v1/erp/extensions/golf-course/caddie-availabilities',
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({
				caddieProfileId,
				date,
				status,
				twoRoundRequest,
				healthNote: healthNote ?? null,
			}),
		},
	)
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	revalidatePath(`/${tenant}/extensions/golf-course/caddies/${caddieProfileId}`)
	return { success: true as const }
}

export async function deleteCaddieAvailabilityAction(
	tenant: string,
	caddieProfileId: string,
	date: string,
) {
	const result = await golfFetch(
		`/v1/erp/extensions/golf-course/caddie-availabilities/${encodeURIComponent(caddieProfileId)}/${date}`,
		tenant,
		{ method: 'DELETE' },
	)
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	revalidatePath(`/${tenant}/extensions/golf-course/caddies/${caddieProfileId}`)
	return { success: true as const }
}

// ─── T09: キャディ自動配置 ──────────────────────────────────────────────────

export type AutoAssignPlanItem = {
	reservationId: string
	scheduledAt: string
	caddieProfileId: string
	caddieDisplayName: string
	rationale: string[]
}

export type AutoAssignResult = {
	dryRun: boolean
	assigned: AutoAssignPlanItem[]
	skipped: { reservationId: string; reason: string }[]
}

/**
 * T09: 対象日のキャディ付き予約へ自動配置（dryRun でプレビュー）。
 * バックエンド未対応（404）の場合は notSupported を返す。
 */
export async function autoAssignCaddiesAction(
	tenant: string,
	date: string,
	dryRun: boolean,
) {
	const result = await golfFetch(
		'/v1/erp/extensions/golf-course/caddie-auto-assignments',
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({ date, dryRun }),
		},
	)
	if (!result.ok) {
		if (result.error.status === 404 || result.error.status === 405) {
			return { success: false as const, notSupported: true as const,
				message: '自動配置APIが未対応です（バックエンド更新後に有効になります）' }
		}
		return { success: false as const, notSupported: false as const, message: result.error.message }
	}
	const data = (await result.response.json()) as AutoAssignResult
	if (!dryRun) {
		revalidatePath(`/${tenant}/extensions/golf-course/caddies`)
	}
	return { success: true as const, data }
}

