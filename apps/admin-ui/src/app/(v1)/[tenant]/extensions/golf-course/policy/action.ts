'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
import { revalidatePath } from 'next/cache'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type SelfLockWindow = {
	weekdays: string[]
	start: string
	end: string
}

export type GolfPolicyHooks = {
	selfLock?: {
		enabled: boolean
		windows: SelfLockWindow[]
	}
	spendJudgment?: {
		enabled: boolean
		minPerPlayer?: number | null
		action?: 'reject' | 'review'
	}
}

export type GolfReservationPolicy = {
	tenantId: string
	reservationTypeId: string
	defaultHoles: number
	maxPlayersPerTeeTime: number
	cartPolicy: string
	memberDepositBps: number
	guestDepositBps: number
	cutoffHours: number
	policyHooksJson: GolfPolicyHooks | null
	metadataJson: unknown
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

/** ポリシー取得。未作成（404）は data:null で返す。 */
export async function fetchGolfReservationPolicyAction(tenant: string) {
	const result = await fetchJsonWithRetry<GolfReservationPolicy>(
		joinServerBackendPath('/v1/erp/extensions/golf-course/reservation-policy'),
		{ headers: await golfHeaders(tenant) },
	)
	if (!result.ok) {
		if (result.error.status === 404) {
			return { success: true as const, data: null }
		}
		return { success: false as const, message: result.error.message }
	}
	return { success: true as const, data: result.data }
}

/**
 * ポリシーフック（セルフロック・客単価判定）を保存する。
 * 既存ポリシーの他フィールドは保持したまま PATCH する
 * （未作成の場合はデフォルト値で新規作成される）。
 */
export async function updateGolfPolicyHooksAction(
	tenant: string,
	hooks: GolfPolicyHooks,
) {
	const current = await fetchGolfReservationPolicyAction(tenant)
	if (!current.success) return current
	const existing = current.data
	const body = {
		reservationTypeId: existing?.reservationTypeId,
		defaultHoles: existing?.defaultHoles ?? 18,
		maxPlayersPerTeeTime: existing?.maxPlayersPerTeeTime ?? 4,
		cartPolicy: existing?.cartPolicy ?? 'optional',
		memberDepositBps: existing?.memberDepositBps ?? 2000,
		guestDepositBps: existing?.guestDepositBps ?? 3000,
		cutoffHours: existing?.cutoffHours ?? 24,
		policyHooksJson: hooks,
		metadataJson: existing?.metadataJson ?? undefined,
	}
	const result = await fetchWithRetry(
		joinServerBackendPath('/v1/erp/extensions/golf-course/reservation-policy'),
		{
			method: 'PATCH',
			headers: await golfHeaders(tenant),
			body: JSON.stringify(body),
		},
	)
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	revalidatePath(`/${tenant}/extensions/golf-course/policy`)
	return { success: true as const }
}
