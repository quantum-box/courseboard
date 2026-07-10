'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type PurchaseOrderStatus = 'Draft' | 'Sent' | 'Received' | 'Invoiced'

export type PurchaseOrderItem = {
	description: string
	quantity: number
	unitCost: number
	taxAmount: number
	amount: number
}

export type PurchaseOrderData = {
	id: string
	tenantId: string
	purchaseOrderNumber: string
	vendorId: string
	vendorName: string
	items: PurchaseOrderItem[]
	status: PurchaseOrderStatus
	currency: string
	expectedDeliveryDate?: string | null
	subtotalAmount: number
	taxAmount: number
	totalAmount: number
	notes?: string | null
	sentAt?: string | null
	receivedAt?: string | null
	invoicedAt?: string | null
	createdAt: string
	updatedAt: string
}

type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

async function erpFetch(path: string, tenant: string, init?: RequestInit) {
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

export async function fetchPurchaseOrdersAction(
	tenant: string,
	status?: string,
): Promise<ActionResult<PurchaseOrderData[]>> {
	const params = new URLSearchParams()
	if (status && status !== 'all') params.set('status', status)
	const res = await erpFetch(`/v1/erp/purchase-orders?${params}`, tenant).catch(
		error => {
			console.error('Failed to fetch purchase orders:', error)
			return null
		},
	)
	if (!res) {
		return { success: false, message: '発注書一覧を取得できませんでした' }
	}
	if (!res.ok) return { success: false, message: await res.text() }
	const data = (await res.json()) as { items: PurchaseOrderData[] }
	return { success: true, data: data.items }
}

export async function fetchPurchaseOrderAction(
	tenant: string,
	id: string,
): Promise<ActionResult<PurchaseOrderData>> {
	const res = await erpFetch(`/v1/erp/purchase-orders/${id}`, tenant).catch(
		error => {
			console.error('Failed to fetch purchase order:', error)
			return null
		},
	)
	if (!res) {
		return { success: false, message: '発注書を取得できませんでした' }
	}
	if (!res.ok) return { success: false, message: await res.text() }
	return { success: true, data: (await res.json()) as PurchaseOrderData }
}

export async function createPurchaseOrderAction(
	tenant: string,
	formData: FormData,
) {
	const descriptions = formData.getAll('description').map(String)
	const quantities = formData.getAll('quantity').map(Number)
	const unitCosts = formData.getAll('unitCost').map(Number)
	const taxAmounts = formData.getAll('taxAmount').map(Number)
	const items = descriptions
		.map((description, index) => ({
			description,
			quantity: quantities[index] || 1,
			unitCost: unitCosts[index] || 0,
			taxAmount: taxAmounts[index] || 0,
		}))
		.filter(item => item.description.trim().length > 0)

	const body = {
		vendorId: String(formData.get('vendorId') || ''),
		vendorName: String(formData.get('vendorName') || '') || undefined,
		expectedDeliveryDate:
			String(formData.get('expectedDeliveryDate') || '') || undefined,
		currency: String(formData.get('currency') || 'JPY'),
		status: String(formData.get('status') || 'Draft'),
		notes: String(formData.get('notes') || '') || undefined,
		items,
	}
	const res = await erpFetch('/v1/erp/purchase-orders', tenant, {
		method: 'POST',
		body: JSON.stringify(body),
	})
	if (!res.ok) throw new Error(await res.text())
	const order = (await res.json()) as PurchaseOrderData
	revalidatePath(`/${tenant}/erp/purchase-orders`)
	redirect(`/${tenant}/erp/purchase-orders/${order.id}`)
}

export async function updatePurchaseOrderStatusAction(
	tenant: string,
	id: string,
	formData: FormData,
) {
	const body = { status: String(formData.get('status') || 'Draft') }
	const res = await erpFetch(`/v1/erp/purchase-orders/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify(body),
	})
	if (!res.ok) throw new Error(await res.text())
	revalidatePath(`/${tenant}/erp/purchase-orders`)
	revalidatePath(`/${tenant}/erp/purchase-orders/${id}`)
}
