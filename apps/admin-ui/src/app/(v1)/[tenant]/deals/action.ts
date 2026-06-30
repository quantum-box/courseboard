'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type DealData = {
	id: string
	tenantId: string
	clientId: string
	name: string
	amount: string
	pipeline: string
	stage: string
	ownerName?: string | null
	memo?: string | null
	providerPrimaryId?: string | null
	createdAt: string
	updatedAt: string
}

export type PipelineStageData = {
	id: string
	label: string
	displayOrder: number
	metadata?: Record<string, string>
	createdAt: string
	updatedAt: string
}

export type PipelineData = {
	id: string
	label: string
	displayOrder: number
	stages: PipelineStageData[]
	createdAt: string
	updatedAt: string
}

type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

async function apiFetch(path: string, tenant: string, init?: RequestInit) {
	const session = await authWithCheck()
	return fetch(joinServerBackendPath(path), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
			...(init?.headers ?? {}),
		},
	})
}

export async function fetchDealsAction(
	tenant: string,
	filters?: { pipeline?: string; stage?: string; clientId?: string },
): Promise<ActionResult<DealData[]>> {
	const search = new URLSearchParams()
	if (filters?.pipeline) search.set('pipeline', filters.pipeline)
	if (filters?.stage) search.set('stage', filters.stage)
	if (filters?.clientId) search.set('clientId', filters.clientId)
	const queryString = search.toString()
	const suffix = queryString ? `?${queryString}` : ''
	const res = await apiFetch(`/v1/erp/deals${suffix}`, tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	const data = (await res.json()) as DealData[] | { items: DealData[] }
	return { success: true, data: Array.isArray(data) ? data : data.items }
}

export async function fetchDealAction(
	tenant: string,
	id: string,
): Promise<ActionResult<DealData>> {
	const res = await apiFetch(`/v1/erp/deals/${id}`, tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	return { success: true, data: (await res.json()) as DealData }
}

export async function fetchPipelinesAction(
	tenant: string,
): Promise<ActionResult<PipelineData[]>> {
	const res = await apiFetch('/v1/graphql', tenant, {
		method: 'POST',
		body: JSON.stringify({
			query: `query DealPipelines {
				pipelines {
					id
					label
					displayOrder
					createdAt
					updatedAt
					stages {
						id
						label
						displayOrder
						metadata
						createdAt
						updatedAt
					}
				}
			}`,
		}),
	})
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	const data = (await res.json()) as {
		data?: { pipelines?: PipelineData[] }
		errors?: { message: string }[]
	}
	if (data.errors?.length) {
		return {
			success: false,
			message: data.errors.map(e => e.message).join('\n'),
		}
	}
	return { success: true, data: data.data?.pipelines ?? [] }
}

export async function createDealAction(tenant: string, formData: FormData) {
	const body = {
		clientId: String(formData.get('clientId') || ''),
		name: String(formData.get('name') || ''),
		amount: String(formData.get('amount') || '0'),
		pipeline: String(formData.get('pipeline') || 'default'),
		stage: String(formData.get('stage') || 'new'),
		ownerName: String(formData.get('ownerName') || ''),
		memo: String(formData.get('memo') || ''),
	}
	const res = await apiFetch('/v1/erp/deals', tenant, {
		method: 'POST',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	const deal = (await res.json()) as DealData
	revalidatePath(`/${tenant}/deals`)
	redirect(`/${tenant}/deals/${deal.id}`)
}

export async function updateDealAction(
	tenant: string,
	id: string,
	formData: FormData,
) {
	const body = {
		clientId: String(formData.get('clientId') || ''),
		name: String(formData.get('name') || ''),
		amount: String(formData.get('amount') || '0'),
		pipeline: String(formData.get('pipeline') || 'default'),
		stage: String(formData.get('stage') || 'new'),
		ownerName: String(formData.get('ownerName') || ''),
		memo: String(formData.get('memo') || ''),
	}
	const res = await apiFetch(`/v1/erp/deals/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	revalidatePath(`/${tenant}/deals/${id}`)
	revalidatePath(`/${tenant}/deals`)
}
