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

// ─── T09: キャディ稼働からのキャディ付枠自動算出 ───────────────────────────

export type CaddieSlotCapacity = {
	/** 午前に稼働できるキャディ数（= 販売可能なキャディ付き午前組数の上限） */
	morningCapacity: number
	/** 午後に稼働できるキャディ数 */
	afternoonCapacity: number
	/** 1日の合計担当可能ラウンド数（2R 可のキャディは 2 とカウント） */
	totalRounds: number
	/** アクティブキャディ総数 */
	activeCaddies: number
	/** 当日「勤務不可」の人数 */
	unavailable: number
	/** 希望休・体調が未登録で「稼働可」とみなした人数 */
	assumedAvailable: number
}

type CapacityProfile = {
	id: string
	active?: boolean
	canTwoRounds: boolean
}

type CapacityAvailability = {
	caddieProfileId: string
	status:
		| 'available'
		| 'unavailable'
		| 'morning_only'
		| 'afternoon_only'
		| 'light_duty'
	twoRoundRequest: boolean
}

/**
 * 指定日のキャディ稼働（希望休・体調・2R可否）から、販売可能な
 * キャディ付き枠数を算出する。既存 API のみ使用（新バックエンド不要）。
 * 希望休が未登録のキャディは「稼働可・2Rなし」として数える。
 */
export async function fetchCaddieSlotCapacityAction(
	tenant: string,
	date: string,
) {
	const headers = await golfHeaders(tenant)
	const [profilesRes, availRes] = await Promise.all([
		fetchWithRetry(
			joinServerBackendPath('/v1/erp/extensions/golf-course/caddie-profiles'),
			{ headers },
		),
		fetchWithRetry(
			joinServerBackendPath(
				`/v1/erp/extensions/golf-course/caddie-availabilities?from=${date}&to=${date}`,
			),
			{ headers },
		),
	])
	if (!profilesRes.ok) {
		return { success: false as const, message: profilesRes.error.message }
	}
	if (!availRes.ok) {
		return { success: false as const, message: availRes.error.message }
	}
	const profiles = ((await profilesRes.response.json()) as {
		items: CapacityProfile[]
	}).items.filter(p => p.active !== false)
	const availabilities = (
		(await availRes.response.json()) as { items: CapacityAvailability[] }
	).items
	const availabilityByCaddie = new Map(
		availabilities.map(a => [a.caddieProfileId, a]),
	)

	let morning = 0
	let afternoon = 0
	let totalRounds = 0
	let unavailable = 0
	let assumedAvailable = 0
	for (const p of profiles) {
		const a = availabilityByCaddie.get(p.id)
		const status = a?.status ?? 'available'
		if (!a) assumedAvailable += 1
		if (status === 'unavailable') {
			unavailable += 1
			continue
		}
		const worksMorning = status !== 'afternoon_only'
		const worksAfternoon = status !== 'morning_only'
		if (worksMorning) morning += 1
		if (worksAfternoon) afternoon += 1
		const twoRounds =
			p.canTwoRounds &&
			(a?.twoRoundRequest ?? false) &&
			status !== 'light_duty' &&
			worksMorning &&
			worksAfternoon
		totalRounds += twoRounds ? 2 : 1
	}

	return {
		success: true as const,
		data: {
			morningCapacity: morning,
			afternoonCapacity: afternoon,
			totalRounds,
			activeCaddies: profiles.length,
			unavailable,
			assumedAvailable,
		} satisfies CaddieSlotCapacity,
	}
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
