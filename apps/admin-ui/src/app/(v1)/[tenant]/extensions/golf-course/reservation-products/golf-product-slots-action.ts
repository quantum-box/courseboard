'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchWithRetry } from 'lib/reliable-fetch'
import { golfCourseApiPaths } from 'lib/extension-admin-registry'
import { revalidatePath } from 'next/cache'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type GolfProductSlot = {
	id: string
	golfReservationProductId: string
	weekday: number
	startTime: string
	endTime: string
	maxGroups: number
	maxPlayers: number
}

type SlotInput = {
	weekday: number
	startTime: string
	endTime: string
	maxGroups: number
	maxPlayers: number
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

export async function fetchGolfProductSlotsAction(
	tenant: string,
	serviceId: string,
) {
	const res = await fetchWithRetry(
		joinServerBackendPath(
			golfCourseApiPaths.reservationProductSlots(serviceId),
		),
		{ headers: await golfHeaders(tenant) },
	)
	if (!res.ok) {
		return { success: false as const, message: res.error.message }
	}
	const json = (await res.response.json()) as { items: GolfProductSlot[] }
	return { success: true as const, data: json.items }
}

export async function replaceGolfProductSlotsAction(
	tenant: string,
	serviceId: string,
	slots: SlotInput[],
) {
	const res = await fetchWithRetry(
		joinServerBackendPath(
			golfCourseApiPaths.reservationProductSlots(serviceId),
		),
		{
			method: 'PUT',
			headers: await golfHeaders(tenant),
			body: JSON.stringify({ slots }),
		},
	)
	if (!res.ok) {
		return { success: false as const, message: res.error.message }
	}
	revalidatePath(`/${tenant}/extensions/golf-course/reservation-products`)
	return { success: true as const }
}
