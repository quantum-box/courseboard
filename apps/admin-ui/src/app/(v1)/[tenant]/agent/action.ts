'use server'

import { authWithCheck } from 'app/auth'
import { getRuntimeEnv } from 'lib/runtime-env'
import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { revalidatePath } from 'next/cache'
import type { InvoiceData } from '../invoices/action'
import type { QuotationData } from '../quotations/action'

const DEFAULT_PLATFORM_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

async function agentFetch(path: string, tenant: string, init?: RequestInit) {
	const session = await authWithCheck()
	return fetch(joinServerBackendPath(path), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id':
				getRuntimeEnv('NEXT_PUBLIC_PLATFORM_ID') ?? DEFAULT_PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
			...(init?.headers ?? {}),
		},
	})
}

export async function fetchAgentQuotationsAction(
	tenant: string,
): Promise<ActionResult<QuotationData[]>> {
	const res = await agentFetch('/api/agent/quotations?limit=20', tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	const data = (await res.json()) as { items: QuotationData[] }
	return { success: true, data: data.items }
}

export async function fetchAgentInvoicesAction(
	tenant: string,
): Promise<ActionResult<InvoiceData[]>> {
	const res = await agentFetch('/api/agent/invoices?limit=20', tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	const data = (await res.json()) as { items: InvoiceData[] }
	return { success: true, data: data.items }
}

export async function sendAgentQuotationAction(tenant: string, id: string) {
	const res = await agentFetch(`/api/agent/quotations/${id}/send`, tenant, {
		method: 'POST',
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	revalidatePath(`/${tenant}/agent`)
	revalidatePath(`/${tenant}/quotations/${id}`)
	revalidatePath(`/${tenant}/quotations`)
}

export async function sendAgentInvoiceAction(tenant: string, id: string) {
	const res = await agentFetch(`/api/agent/invoices/${id}/send`, tenant, {
		method: 'POST',
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	revalidatePath(`/${tenant}/agent`)
	revalidatePath(`/${tenant}/invoices/${id}`)
	revalidatePath(`/${tenant}/invoices`)
}
