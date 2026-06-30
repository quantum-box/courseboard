'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
import { revalidatePath } from 'next/cache'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type GolfReservationProduct = {
	id: string
	tenantId: string
	extensionKey: string
	reservationServiceId: string
	playType: 'caddie' | 'self'
	holeCount: number
	expectedDurationMinutes: number
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

async function golfMutate(path: string, tenant: string, init: RequestInit) {
	const result = await fetchWithRetry(joinServerBackendPath(path), {
		...init,
		headers: {
			...(await golfHeaders(tenant)),
			...(init.headers ?? {}),
		},
	})
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	return { success: true as const }
}

export async function fetchGolfReservationProductsAction(tenant: string) {
	const result = await golfFetchJson<{ items: GolfReservationProduct[] }>(
		'/v1/erp/extensions/golf-course/reservation-products',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function upsertGolfReservationProductAction(
	tenant: string,
	serviceId: string,
	playType: 'caddie' | 'self',
	holeCount: number,
	expectedDurationMinutes: number,
) {
	const result = await golfMutate(
		`/v1/erp/extensions/golf-course/reservation-products/${encodeURIComponent(serviceId)}`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({ playType, holeCount, expectedDurationMinutes }),
		},
	)
	if (result.success) {
		revalidatePath(`/${tenant}/extensions/golf-course/reservation-products`)
	}
	return result
}
