'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import {
	type FetchFailure,
	fetchJsonWithRetry,
	fetchWithRetry,
} from 'lib/reliable-fetch'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type OrderStatus =
	| 'Pending'
	| 'Confirmed'
	| 'Shipped'
	| 'Completed'
	| 'Cancelled'

export type OrderItem = {
	sku?: string | null
	description: string
	quantity: number
	unitPrice: number
	amount: number
}

export type OrderData = {
	id: string
	tenantId: string
	orderNumber: string
	clientId: string
	clientName?: string | null
	clientEmail?: string | null
	items: OrderItem[]
	status: OrderStatus
	source: string
	currency: string
	subtotalAmount: number
	taxAmount: number
	totalAmount: number
	squareOrderId?: string | null
	squarePaymentId?: string | null
	convertedInvoiceId?: string | null
	inventoryDecrementedAt?: string | null
	notes?: string | null
	confirmedAt?: string | null
	shippedAt?: string | null
	completedAt?: string | null
	cancelledAt?: string | null
	createdAt: string
	updatedAt: string
}

type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
	error?: FetchFailure
}

async function orderFetch(path: string, tenant: string, init?: RequestInit) {
	const session = await authWithCheck()
	return fetchWithRetry(joinServerBackendPath(path), {
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

async function orderFetchJson<T>(
	path: string,
	tenant: string,
	init?: RequestInit,
): Promise<ActionResult<T>> {
	const session = await authWithCheck()
	const result = await fetchJsonWithRetry<T>(joinServerBackendPath(path), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
			...(init?.headers ?? {}),
		},
	})

	if (!result.ok) {
		console.error('Failed to fetch order data:', {
			path,
			tenant,
			kind: result.error.kind,
			status: result.error.status,
			attempts: result.error.attempts,
			body: result.error.body,
		})
		return {
			success: false,
			message: result.error.message,
			error: result.error,
		}
	}

	return { success: true, data: result.data }
}

export async function fetchOrdersAction(
	tenant: string,
	status?: string,
): Promise<ActionResult<OrderData[]>> {
	const search = status && status !== 'all' ? `?status=${status}` : ''
	const result = await orderFetchJson<{ items: OrderData[] }>(
		`/v1/erp/orders${search}`,
		tenant,
	)
	if (!result.success) {
		return {
			success: false,
			message: result.message,
			error: result.error,
		}
	}
	return { success: true, data: result.data?.items ?? [] }
}

export async function fetchOrderAction(
	tenant: string,
	id: string,
): Promise<ActionResult<OrderData>> {
	return orderFetchJson<OrderData>(`/v1/erp/orders/${id}`, tenant)
}

export async function createOrderAction(tenant: string, formData: FormData) {
	const descriptions = formData.getAll('description').map(String)
	const skus = formData.getAll('sku').map(String)
	const quantities = formData.getAll('quantity').map(Number)
	const unitPrices = formData.getAll('unitPrice').map(Number)
	const items = descriptions
		.map((description, index) => ({
			description,
			sku: skus[index] || undefined,
			quantity: quantities[index] || 1,
			unitPrice: unitPrices[index] || 0,
		}))
		.filter(item => item.description.trim().length > 0)
	const body = {
		clientId: String(formData.get('clientId') || ''),
		clientName: String(formData.get('clientName') || '') || undefined,
		clientEmail: String(formData.get('clientEmail') || '') || undefined,
		status: String(formData.get('status') || 'Pending'),
		source: String(formData.get('source') || 'manual'),
		taxAmount: Number(formData.get('taxAmount') || 0),
		notes: String(formData.get('notes') || '') || undefined,
		items,
	}
	const res = await orderFetch('/v1/erp/orders', tenant, {
		method: 'POST',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	const order = (await res.response.json()) as OrderData
	revalidatePath(`/${tenant}/orders`)
	redirect(`/${tenant}/orders/${order.id}`)
}

export async function updateOrderAction(
	tenant: string,
	id: string,
	formData: FormData,
) {
	const body = {
		status: String(formData.get('status') || 'Pending'),
		notes: String(formData.get('notes') || '') || undefined,
		decrementInventory: formData.get('decrementInventory') === 'on',
	}
	const res = await orderFetch(`/v1/erp/orders/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/orders/${id}`)
	revalidatePath(`/${tenant}/orders`)
}

export async function shipOrderAction(tenant: string, id: string) {
	const res = await orderFetch(`/v1/erp/orders/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'Shipped', decrementInventory: true }),
	})
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	revalidatePath(`/${tenant}/orders/${id}`)
	revalidatePath(`/${tenant}/orders`)
}

export async function convertOrderToInvoiceAction(tenant: string, id: string) {
	const res = await orderFetch(
		`/v1/erp/orders/${id}/convert-to-invoice`,
		tenant,
		{
			method: 'POST',
		},
	)
	if (!res.ok) {
		throw new Error(res.error.message)
	}
	const result = (await res.response.json()) as { invoiceId?: string }
	revalidatePath(`/${tenant}/orders/${id}`)
	revalidatePath(`/${tenant}/invoices`)
	redirect(
		result.invoiceId
			? `/${tenant}/invoices/${result.invoiceId}`
			: `/${tenant}/invoices`,
	)
}
