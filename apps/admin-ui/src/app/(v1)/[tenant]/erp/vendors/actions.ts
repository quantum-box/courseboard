'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type VendorStatus = 'Active' | 'Inactive'

export type VendorData = {
	id: string
	tenantId: string
	name: string
	contactName?: string | null
	contactEmail?: string | null
	contactPhone?: string | null
	address?: string | null
	paymentTerms?: string | null
	status: VendorStatus
	notes?: string | null
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

export async function fetchVendorsAction(
	tenant: string,
	status?: string,
	search?: string,
): Promise<ActionResult<VendorData[]>> {
	const params = new URLSearchParams()
	if (status && status !== 'all') params.set('status', status)
	if (search) params.set('search', search)
	const res = await erpFetch(`/v1/erp/vendors?${params}`, tenant).catch(
		error => {
			console.error('Failed to fetch vendors:', error)
			return null
		},
	)
	if (!res) {
		return { success: false, message: '仕入先一覧を取得できませんでした' }
	}
	if (!res.ok) return { success: false, message: await res.text() }
	const data = (await res.json()) as { items: VendorData[] }
	return { success: true, data: data.items }
}

export async function fetchVendorAction(
	tenant: string,
	id: string,
): Promise<ActionResult<VendorData>> {
	const res = await erpFetch(`/v1/erp/vendors/${id}`, tenant).catch(error => {
		console.error('Failed to fetch vendor:', error)
		return null
	})
	if (!res) {
		return { success: false, message: '仕入先を取得できませんでした' }
	}
	if (!res.ok) return { success: false, message: await res.text() }
	return { success: true, data: (await res.json()) as VendorData }
}

export async function createVendorAction(tenant: string, formData: FormData) {
	const body = {
		name: String(formData.get('name') || ''),
		contactName: String(formData.get('contactName') || '') || undefined,
		contactEmail: String(formData.get('contactEmail') || '') || undefined,
		contactPhone: String(formData.get('contactPhone') || '') || undefined,
		address: String(formData.get('address') || '') || undefined,
		paymentTerms: String(formData.get('paymentTerms') || '') || undefined,
		status: String(formData.get('status') || 'Active'),
		notes: String(formData.get('notes') || '') || undefined,
	}
	const res = await erpFetch('/v1/erp/vendors', tenant, {
		method: 'POST',
		body: JSON.stringify(body),
	})
	if (!res.ok) throw new Error(await res.text())
	const vendor = (await res.json()) as VendorData
	revalidatePath(`/${tenant}/erp/vendors`)
	redirect(`/${tenant}/erp/vendors/${vendor.id}`)
}

export async function updateVendorAction(
	tenant: string,
	id: string,
	formData: FormData,
) {
	const body = {
		name: String(formData.get('name') || ''),
		contactName: String(formData.get('contactName') || '') || null,
		contactEmail: String(formData.get('contactEmail') || '') || null,
		contactPhone: String(formData.get('contactPhone') || '') || null,
		address: String(formData.get('address') || '') || null,
		paymentTerms: String(formData.get('paymentTerms') || '') || null,
		status: String(formData.get('status') || 'Active'),
		notes: String(formData.get('notes') || '') || null,
	}
	const res = await erpFetch(`/v1/erp/vendors/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify(body),
	})
	if (!res.ok) throw new Error(await res.text())
	revalidatePath(`/${tenant}/erp/vendors`)
	revalidatePath(`/${tenant}/erp/vendors/${id}`)
}
