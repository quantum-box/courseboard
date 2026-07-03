'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
// fetchWithRetry is used by golfMutate
import { revalidatePath } from 'next/cache'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type GolfCourse = {
	id: string
	name: string
	shortName?: string | null
	holeCount: number
	timezone: string
	businessHoursJson?: { open: string; close: string } | null
	startIntervalMinutes: number
	isActive: boolean
	createdAt: string
	updatedAt: string
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

async function golfMutate(
	path: string,
	tenant: string,
	init: RequestInit,
): Promise<{ ok: boolean; status: number }> {
	const result = await fetchWithRetry(joinServerBackendPath(path), {
		...init,
		headers: {
			...(await golfHeaders(tenant)),
			...(init.headers ?? {}),
		},
	})
	if (!result.ok) {
		return { ok: false, status: 0 }
	}
	return { ok: result.response.ok, status: result.response.status }
}

function coursesPath(tenant: string) {
	return `/${tenant}/extensions/golf-course/courses`
}

export async function fetchGolfCoursesAction(tenant: string) {
	const result = await golfFetchJson<{ items: GolfCourse[] }>(
		'/v1/erp/extensions/golf-course/courses',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function createGolfCourseAction(
	tenant: string,
	_prevState: unknown,
	formData: FormData,
) {
	const body = {
		name: formData.get('name') as string,
		shortName: (formData.get('shortName') as string) || null,
		holeCount: Number(formData.get('holeCount') ?? 18),
		timezone: (formData.get('timezone') as string) || 'Asia/Tokyo',
		startIntervalMinutes: Number(formData.get('startIntervalMinutes') ?? 10),
		isActive: true,
	}

	const res = await golfMutate(
		'/v1/erp/extensions/golf-course/courses',
		tenant,
		{ method: 'POST', body: JSON.stringify(body) },
	)
	if (!res.ok) {
		return { success: false as const, message: `作成失敗 (${res.status})` }
	}
	revalidatePath(coursesPath(tenant))
	return { success: true as const }
}

export async function updateGolfCourseAction(
	tenant: string,
	id: string,
	_prevState: unknown,
	formData: FormData,
) {
	const body = {
		name: formData.get('name') as string,
		shortName: (formData.get('shortName') as string) || null,
		holeCount: Number(formData.get('holeCount') ?? 18),
		timezone: (formData.get('timezone') as string) || 'Asia/Tokyo',
		startIntervalMinutes: Number(formData.get('startIntervalMinutes') ?? 10),
		isActive: formData.get('isActive') === 'true',
	}

	const res = await golfMutate(
		`/v1/erp/extensions/golf-course/courses/${encodeURIComponent(id)}`,
		tenant,
		{ method: 'PATCH', body: JSON.stringify(body) },
	)
	if (!res.ok) {
		return { success: false as const, message: `更新失敗 (${res.status})` }
	}
	revalidatePath(coursesPath(tenant))
	return { success: true as const }
}

export async function deleteGolfCourseAction(tenant: string, id: string) {
	const res = await golfMutate(
		`/v1/erp/extensions/golf-course/courses/${encodeURIComponent(id)}`,
		tenant,
		{ method: 'DELETE' },
	)
	if (!res.ok && res.status !== 204) {
		return { success: false as const, message: `削除失敗 (${res.status})` }
	}
	revalidatePath(coursesPath(tenant))
	return { success: true as const }
}
