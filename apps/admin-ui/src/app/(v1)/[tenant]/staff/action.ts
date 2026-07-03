'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
import { revalidatePath } from 'next/cache'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type StaffMemberData = {
	id: string
	name: string
	employmentType: 'full_time' | 'part_time' | 'contract'
	active: boolean
	hiredAt?: string | null
	contractEndDate?: string | null
	phone?: string | null
	email?: string | null
	attributesJson?: Record<string, unknown> | null
	createdAt: string
	updatedAt: string
}

export type StaffShiftPreferenceData = {
	staffId?: string
	monthlyIncomeTargetYen?: number | null
	desiredWorkDaysPerWeek?: number | null
	preferredTimeBand?: 'any' | 'morning' | 'afternoon' | 'evening' | null
	preferredDays?: string[]
	unavailableDates?: string[]
	availableLocations?: string[]
	notes?: string | null
}

export type StaffShiftData = {
	id: string
	staffId: string
	date: string
	startTime: string
	endTime: string
	shiftType: string
	notes?: string | null
}

export type StaffUtilizationData = {
	staffId: string
	period: string
	shiftedMinutes: number
	workedMinutes: number
	utilizationRate: number
}

export type StaffLeaveRequestData = {
	id: string
	staffId: string
	date: string
	requestType: 'day_off' | 'paid_leave' | 'unavailable'
	status: 'requested' | 'approved' | 'rejected' | 'cancelled'
	reason?: string | null
	decidedBy?: string | null
	decidedAt?: string | null
	decisionNote?: string | null
	createdAt: string
	updatedAt: string
}

export type StaffSkillProfileData = {
	staffId: string
	skillTags: string[]
	certifications: string[]
	languages: string[]
	maxRoundsPerDay?: number | null
	notes?: string | null
}

export type StaffCompensationProfileData = {
	staffId: string
	hourlyRateYen?: number | null
	dailyRateYen?: number | null
	roundRateYen?: number | null
	nominationFeeYen?: number | null
	transportAllowanceYen?: number | null
	currency: string
	notes?: string | null
}

export type StaffPayrollEstimateData = {
	staffId: string
	period: string
	workedMinutes: number
	workedDays: number
	shiftedDays: number
	estimatedAmountYen: number
	monthlyIncomeTargetYen?: number | null
	targetGapYen?: number | null
	currency: string
}

async function staffFetch(path: string, tenant: string, init?: RequestInit) {
	const session = await authWithCheck()
	const headers = new Headers(init?.headers)
	headers.set('Content-Type', 'application/json')
	headers.set('x-platform-id', PLATFORM_ID)
	headers.set('x-operator-id', tenant)
	headers.set('Authorization', `Bearer ${session.accessToken}`)
	return fetchWithRetry(joinServerBackendPath(path), {
		...init,
		headers,
	})
}

async function staffFetchJson<T>(path: string, tenant: string) {
	const session = await authWithCheck()
	const headers = new Headers()
	headers.set('Content-Type', 'application/json')
	headers.set('x-platform-id', PLATFORM_ID)
	headers.set('x-operator-id', tenant)
	headers.set('Authorization', `Bearer ${session.accessToken}`)
	const result = await fetchJsonWithRetry<T>(joinServerBackendPath(path), {
		headers,
	})
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	return { success: true as const, data: result.data }
}

export async function fetchStaffMembersAction(tenant: string) {
	const result = await staffFetchJson<{ items: StaffMemberData[] }>(
		'/v1/erp/hrm/staff',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchStaffShiftsAction(tenant: string, staffId: string) {
	const result = await staffFetchJson<{ items: StaffShiftData[] }>(
		`/v1/erp/hrm/staff/${staffId}/shifts`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchStaffShiftPreferenceAction(
	tenant: string,
	staffId: string,
) {
	const result = await staffFetchJson<{
		item: StaffShiftPreferenceData | null
	}>(`/v1/erp/hrm/staff/${staffId}/shift-preference`, tenant)
	return result.success
		? { success: true as const, data: result.data.item }
		: result
}

export async function fetchStaffUtilizationAction(
	tenant: string,
	staffId: string,
	period = 'week',
) {
	return staffFetchJson<StaffUtilizationData>(
		`/v1/erp/hrm/staff/${staffId}/utilization?period=${period}`,
		tenant,
	)
}

export async function fetchStaffLeaveRequestsAction(
	tenant: string,
	staffId: string,
) {
	const result = await staffFetchJson<{ items: StaffLeaveRequestData[] }>(
		`/v1/erp/hrm/staff/${staffId}/leave-requests`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchStaffSkillProfileAction(
	tenant: string,
	staffId: string,
) {
	const result = await staffFetchJson<{ item: StaffSkillProfileData | null }>(
		`/v1/erp/hrm/staff/${staffId}/skills`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.item }
		: result
}

export async function fetchStaffCompensationProfileAction(
	tenant: string,
	staffId: string,
) {
	const result = await staffFetchJson<{
		item: StaffCompensationProfileData | null
	}>(`/v1/erp/hrm/staff/${staffId}/compensation`, tenant)
	return result.success
		? { success: true as const, data: result.data.item }
		: result
}

export async function fetchStaffPayrollEstimateAction(
	tenant: string,
	staffId: string,
	period = 'month',
) {
	return staffFetchJson<StaffPayrollEstimateData>(
		`/v1/erp/hrm/staff/${staffId}/payroll-estimate?period=${period}`,
		tenant,
	)
}

export async function createStaffMemberAction(
	tenant: string,
	formData: FormData,
) {
	const res = await staffFetch('/v1/erp/hrm/staff', tenant, {
		method: 'POST',
		body: JSON.stringify({
			name: String(formData.get('name') ?? ''),
			employmentType: String(formData.get('employmentType') ?? 'part_time'),
			active: true,
			hiredAt: optionalText(formData.get('hiredAt')),
			contractEndDate: optionalText(formData.get('contractEndDate')),
			phone: optionalText(formData.get('phone')),
			email: optionalText(formData.get('email')),
		}),
	})
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

function splitLines(value: FormDataEntryValue | null) {
	return String(value ?? '')
		.split(/\r?\n|,/)
		.map(item => item.trim())
		.filter(Boolean)
}

function optionalNumber(value: FormDataEntryValue | null) {
	const text = String(value ?? '').trim()
	if (!text) {
		return null
	}
	const parsed = Number(text)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function optionalText(value: FormDataEntryValue | null) {
	const text = String(value ?? '').trim()
	return text || null
}

export async function updateStaffShiftPreferenceAction(
	tenant: string,
	staffId: string,
	formData: FormData,
) {
	const res = await staffFetch(
		`/v1/erp/hrm/staff/${staffId}/shift-preference`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				monthlyIncomeTargetYen: optionalNumber(
					formData.get('monthlyIncomeTargetYen'),
				),
				desiredWorkDaysPerWeek: optionalNumber(
					formData.get('desiredWorkDaysPerWeek'),
				),
				preferredTimeBand: String(formData.get('preferredTimeBand') ?? 'any'),
				preferredDays: formData.getAll('preferredDays').map(String),
				unavailableDates: splitLines(formData.get('unavailableDates')),
				availableLocations: splitLines(formData.get('availableLocations')),
				notes: String(formData.get('notes') ?? '').trim() || null,
			}),
		},
	)
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

export async function createStaffLeaveRequestAction(
	tenant: string,
	staffId: string,
	formData: FormData,
) {
	const res = await staffFetch(
		`/v1/erp/hrm/staff/${staffId}/leave-requests`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({
				date: String(formData.get('date') ?? ''),
				requestType: String(formData.get('requestType') ?? 'day_off'),
				reason: String(formData.get('reason') ?? '').trim() || null,
			}),
		},
	)
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

export async function decideStaffLeaveRequestAction(
	tenant: string,
	requestId: string,
	status: StaffLeaveRequestData['status'],
) {
	const res = await staffFetch(
		`/v1/erp/hrm/leave-requests/${requestId}`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				status,
				decidedBy: 'admin-ui',
			}),
		},
	)
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

export async function updateStaffSkillProfileAction(
	tenant: string,
	staffId: string,
	formData: FormData,
) {
	const res = await staffFetch(`/v1/erp/hrm/staff/${staffId}/skills`, tenant, {
		method: 'PATCH',
		body: JSON.stringify({
			skillTags: splitLines(formData.get('skillTags')),
			certifications: splitLines(formData.get('certifications')),
			languages: splitLines(formData.get('languages')),
			maxRoundsPerDay: optionalNumber(formData.get('maxRoundsPerDay')),
			notes: String(formData.get('notes') ?? '').trim() || null,
		}),
	})
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

export async function updateStaffCompensationProfileAction(
	tenant: string,
	staffId: string,
	formData: FormData,
) {
	const res = await staffFetch(
		`/v1/erp/hrm/staff/${staffId}/compensation`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				hourlyRateYen: optionalNumber(formData.get('hourlyRateYen')),
				dailyRateYen: optionalNumber(formData.get('dailyRateYen')),
				roundRateYen: optionalNumber(formData.get('roundRateYen')),
				nominationFeeYen: optionalNumber(formData.get('nominationFeeYen')),
				transportAllowanceYen: optionalNumber(
					formData.get('transportAllowanceYen'),
				),
				currency: String(formData.get('currency') ?? 'JPY').trim() || 'JPY',
				notes: String(formData.get('notes') ?? '').trim() || null,
			}),
		},
	)
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

export async function createStaffShiftAction(
	tenant: string,
	staffId: string,
	formData: FormData,
) {
	const res = await staffFetch(`/v1/erp/hrm/staff/${staffId}/shifts`, tenant, {
		method: 'POST',
		body: JSON.stringify({
			date: String(formData.get('date') ?? ''),
			startTime: String(formData.get('startTime') ?? ''),
			endTime: String(formData.get('endTime') ?? ''),
			shiftType: String(formData.get('shiftType') ?? 'regular'),
			notes: String(formData.get('notes') ?? '') || undefined,
		}),
	})
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

export async function clockInStaffAction(tenant: string, staffId: string) {
	const res = await staffFetch(
		`/v1/erp/hrm/staff/${staffId}/clock-in`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({}),
		},
	)
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}

export async function clockOutStaffAction(
	tenant: string,
	staffId: string,
	formData: FormData,
) {
	const res = await staffFetch(
		`/v1/erp/hrm/staff/${staffId}/clock-out`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({
				breakMinutes: Number(formData.get('breakMinutes') ?? 0),
			}),
		},
	)
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/hrm/staff`)
}
