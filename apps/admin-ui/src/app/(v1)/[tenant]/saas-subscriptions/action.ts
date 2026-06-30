'use server'

import { authWithCheck } from 'app/auth'
import { getRuntimeEnv } from 'lib/runtime-env'
import { joinServerBackendPath } from 'lib/serverBackendUrl'
import type { SaasChangeRequest, SaasSubscription } from './types'

const DEFAULT_PLATFORM_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type ActionResult<T> = {
	success: boolean
	data?: T
	message?: string
}

type ApiSubscription = {
	id: string
	serviceName: string
	ownerTeam: string
	currentPlan: string
	nextPlan?: string | null
	status: SaasSubscription['status']
	monthlyAmountYen: number
	billingCycle: SaasSubscription['billingCycle']
	renewalDate: string
	seats: number
	reason: string
	approvalState: SaasSubscription['approvalState']
}

type ApiChangeRequest = {
	id: string
	subscriptionId?: string | null
	serviceName: string
	requester: string
	changeType: SaasChangeRequest['changeType']
	fromPlan?: string | null
	toPlan?: string | null
	reason: string
	requestedAt: string
	estimatedDeltaYen: number
	approver: string
	state: SaasChangeRequest['state']
}

type ApiSubscriptionListResponse = {
	items: ApiSubscription[]
	summary: {
		subscriptionCount: number
		monthlyTotalYen: number
		pendingDeltaYen: number
		renewalReviewCount: number
	}
}

type ApiRequestListResponse = {
	items: ApiChangeRequest[]
}

export type SaasSubscriptionWorkspaceData = {
	subscriptions: SaasSubscription[]
	requests: SaasChangeRequest[]
	summary: ApiSubscriptionListResponse['summary']
}

function toSubscription(item: ApiSubscription): SaasSubscription {
	return {
		id: item.id,
		serviceName: item.serviceName,
		ownerTeam: item.ownerTeam,
		currentPlan: item.currentPlan,
		nextPlan: item.nextPlan ?? undefined,
		status: item.status,
		monthlyAmount: item.monthlyAmountYen,
		billingCycle: item.billingCycle,
		renewalDate: item.renewalDate,
		seats: item.seats,
		reason: item.reason,
		approvalState: item.approvalState,
	}
}

function toChangeRequest(item: ApiChangeRequest): SaasChangeRequest {
	return {
		id: item.id,
		subscriptionId: item.subscriptionId ?? undefined,
		serviceName: item.serviceName,
		requester: item.requester,
		changeType: item.changeType,
		fromPlan: item.fromPlan ?? undefined,
		toPlan: item.toPlan ?? undefined,
		reason: item.reason,
		requestedAt: item.requestedAt,
		estimatedDelta: item.estimatedDeltaYen,
		approver: item.approver,
		state: item.state,
	}
}

async function apiFetch<T>(
	path: string,
	tenantId: string,
	init?: RequestInit,
): Promise<ActionResult<T>> {
	const session = await authWithCheck()
	try {
		const response = await fetch(joinServerBackendPath(path), {
			...init,
			headers: {
				'Content-Type': 'application/json',
				'x-platform-id':
					getRuntimeEnv('NEXT_PUBLIC_PLATFORM_ID') ?? DEFAULT_PLATFORM_ID,
				'x-operator-id': tenantId,
				Authorization: `Bearer ${session.accessToken}`,
				...init?.headers,
			},
			cache: 'no-store',
		})

		if (!response.ok) {
			return { success: false, message: await response.text() }
		}

		return { success: true, data: (await response.json()) as T }
	} catch (error) {
		return {
			success: false,
			message:
				error instanceof Error
					? error.message
					: 'SaaS契約管理APIへの接続に失敗しました',
		}
	}
}

export async function fetchSaasSubscriptionWorkspaceAction(
	tenantId: string,
): Promise<ActionResult<SaasSubscriptionWorkspaceData>> {
	const [subscriptions, requests] = await Promise.all([
		apiFetch<ApiSubscriptionListResponse>(
			'/v1/erp/saas-subscriptions',
			tenantId,
		),
		apiFetch<ApiRequestListResponse>(
			'/v1/erp/saas-subscription-requests',
			tenantId,
		),
	])

	if (!subscriptions.success) {
		return {
			success: false,
			message: subscriptions.message ?? 'SaaS契約の取得に失敗しました',
		}
	}
	if (!requests.success) {
		return {
			success: false,
			message: requests.message ?? 'SaaS変更申請の取得に失敗しました',
		}
	}

	return {
		success: true,
		data: {
			subscriptions: subscriptions.data?.items.map(toSubscription) ?? [],
			requests: requests.data?.items.map(toChangeRequest) ?? [],
			summary: subscriptions.data?.summary ?? {
				subscriptionCount: 0,
				monthlyTotalYen: 0,
				pendingDeltaYen: 0,
				renewalReviewCount: 0,
			},
		},
	}
}

export async function createSaasChangeRequestAction(
	tenantId: string,
	input: {
		subscriptionId?: string
		serviceName: string
		changeType: SaasChangeRequest['changeType']
		fromPlan?: string
		toPlan?: string
		reason: string
		estimatedDeltaYen: number
		approver: string
	},
): Promise<ActionResult<SaasChangeRequest>> {
	const result = await apiFetch<ApiChangeRequest>(
		'/v1/erp/saas-subscription-requests',
		tenantId,
		{
			body: JSON.stringify(input),
			method: 'POST',
		},
	)

	return result.success
		? {
				success: true,
				data: result.data ? toChangeRequest(result.data) : undefined,
			}
		: { success: false, message: result.message }
}

export async function approveSaasChangeRequestAction(
	tenantId: string,
	id: string,
	note?: string,
): Promise<ActionResult<SaasChangeRequest>> {
	const result = await apiFetch<ApiChangeRequest>(
		`/v1/erp/saas-subscription-requests/${id}/approve`,
		tenantId,
		{
			body: JSON.stringify({ note }),
			method: 'POST',
		},
	)

	return result.success
		? {
				success: true,
				data: result.data ? toChangeRequest(result.data) : undefined,
			}
		: { success: false, message: result.message }
}

export async function returnSaasChangeRequestAction(
	tenantId: string,
	id: string,
	note: string,
): Promise<ActionResult<SaasChangeRequest>> {
	const result = await apiFetch<ApiChangeRequest>(
		`/v1/erp/saas-subscription-requests/${id}/return`,
		tenantId,
		{
			body: JSON.stringify({ note }),
			method: 'POST',
		},
	)

	return result.success
		? {
				success: true,
				data: result.data ? toChangeRequest(result.data) : undefined,
			}
		: { success: false, message: result.message }
}
