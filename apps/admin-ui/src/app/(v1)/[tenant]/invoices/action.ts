'use server'

import { authWithCheck } from 'app/auth'
import { getRuntimeEnv } from 'lib/runtime-env'
import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const DEFAULT_PLATFORM_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type InvoiceStatus = 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'

export type InvoiceLineItem = {
	description: string
	quantity: number
	unitPrice: number
	amount: number
}

export type InvoiceData = {
	id: string
	tenantId: string
	invoiceNumber: string
	clientId: string
	clientName?: string | null
	clientEmail?: string | null
	lineItems: InvoiceLineItem[]
	dueDate: string
	status: InvoiceStatus
	currency: string
	subtotalAmount: number
	taxAmount: number
	totalAmount: number
	paymentLinkUrl?: string | null
	squarePaymentLinkId?: string | null
	notes?: string | null
	sentAt?: string | null
	paidAt?: string | null
	createdAt: string
	updatedAt: string
}

type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

async function invoiceFetch(path: string, tenant: string, init?: RequestInit) {
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

export async function fetchInvoicesAction(
	tenant: string,
	status?: string,
): Promise<ActionResult<InvoiceData[]>> {
	const search = status && status !== 'all' ? `?status=${status}` : ''
	const res = await invoiceFetch(`/v1/invoices${search}`, tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	const data = (await res.json()) as { items: InvoiceData[] }
	return { success: true, data: data.items }
}

export async function fetchInvoiceAction(
	tenant: string,
	id: string,
): Promise<ActionResult<InvoiceData>> {
	const res = await invoiceFetch(`/v1/invoices/${id}`, tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	return { success: true, data: (await res.json()) as InvoiceData }
}

export async function createInvoiceAction(tenant: string, formData: FormData) {
	const descriptions = formData.getAll('description').map(String)
	const quantities = formData.getAll('quantity').map(Number)
	const unitPrices = formData.getAll('unitPrice').map(Number)
	const lineItems = descriptions
		.map((description, index) => ({
			description,
			quantity: quantities[index] || 1,
			unitPrice: unitPrices[index] || 0,
		}))
		.filter(item => item.description.trim().length > 0)
	const clientName = String(formData.get('clientName') || '')
	const clientId = String(formData.get('clientId') || clientName || '')

	const body = {
		clientId,
		clientName: clientName || undefined,
		clientEmail: String(formData.get('clientEmail') || '') || undefined,
		dueDate: String(formData.get('dueDate') || ''),
		taxAmount: Number(formData.get('taxAmount') || 0),
		notes: String(formData.get('notes') || '') || undefined,
		lineItems,
		createPaymentLink: formData.get('createPaymentLink') === 'on',
		paymentLinkProvider: 'stripe',
		sendEmail: formData.get('sendEmail') === 'on',
	}
	const res = await invoiceFetch('/v1/invoices', tenant, {
		method: 'POST',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	const invoice = (await res.json()) as InvoiceData
	revalidatePath(`/${tenant}/invoices`)
	redirect(`/${tenant}/invoices/${invoice.id}`)
}

export async function updateInvoiceStatusAction(
	tenant: string,
	id: string,
	formData: FormData,
) {
	const body = {
		status: String(formData.get('status') || 'Draft'),
		sendEmail: formData.get('sendEmail') === 'on',
		createPaymentLink: formData.get('createPaymentLink') === 'on',
		paymentLinkProvider: 'stripe',
	}
	const res = await invoiceFetch(`/v1/invoices/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	revalidatePath(`/${tenant}/invoices/${id}`)
}
