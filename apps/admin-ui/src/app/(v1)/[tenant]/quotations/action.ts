'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type QuotationStatus =
	| 'Draft'
	| 'Sent'
	| 'Accepted'
	| 'Rejected'
	| 'Expired'

export type QuotationItem = {
	description: string
	quantity: number
	unitPrice: number
	discountAmount: number
	amount: number
}

export type QuotationData = {
	id: string
	tenantId: string
	quotationNumber: string
	clientId: string
	clientName?: string | null
	clientEmail?: string | null
	items: QuotationItem[]
	validUntil: string
	status: QuotationStatus
	currency: string
	subtotalAmount: number
	discountAmount: number
	taxAmount: number
	totalAmount: number
	paymentLinkUrl?: string | null
	squarePaymentLinkId?: string | null
	notes?: string | null
	sentAt?: string | null
	acceptedAt?: string | null
	convertedInvoiceId?: string | null
	createdAt: string
	updatedAt: string
}

type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

async function quotationFetch(
	path: string,
	tenant: string,
	init?: RequestInit,
) {
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

export async function fetchQuotationsAction(
	tenant: string,
	status?: string,
): Promise<ActionResult<QuotationData[]>> {
	const search = status && status !== 'all' ? `?status=${status}` : ''
	const res = await quotationFetch(`/v1/erp/quotations${search}`, tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	const data = (await res.json()) as
		| QuotationData[]
		| { items: QuotationData[] }
	return { success: true, data: Array.isArray(data) ? data : data.items }
}

export async function fetchQuotationAction(
	tenant: string,
	id: string,
): Promise<ActionResult<QuotationData>> {
	const res = await quotationFetch(`/v1/erp/quotations/${id}`, tenant)
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	return { success: true, data: (await res.json()) as QuotationData }
}

export async function createQuotationAction(
	tenant: string,
	formData: FormData,
) {
	const descriptions = formData.getAll('description').map(String)
	const quantities = formData.getAll('quantity').map(Number)
	const unitPrices = formData.getAll('unitPrice').map(Number)
	const discountAmounts = formData.getAll('discountAmount').map(Number)
	const taxAmounts = formData.getAll('itemTaxAmount').map(Number)
	const lineTaxAmount = taxAmounts.reduce(
		(sum, amount) => sum + (amount || 0),
		0,
	)
	const items = descriptions
		.map((description, index) => ({
			description,
			quantity: quantities[index] || 1,
			unitPrice: unitPrices[index] || 0,
			discountAmount: discountAmounts[index] || 0,
		}))
		.filter(item => item.description.trim().length > 0)
	const clientName = String(formData.get('clientName') || '')
	const clientId = String(formData.get('clientId') || clientName || '')

	const body = {
		clientId,
		clientName: clientName || undefined,
		clientEmail: String(formData.get('clientEmail') || '') || undefined,
		validUntil: String(formData.get('validUntil') || ''),
		currency: String(formData.get('currency') || 'JPY'),
		taxAmount: Number(formData.get('taxAmount') || 0) + lineTaxAmount,
		notes: String(formData.get('notes') || '') || undefined,
		items,
		createPaymentLink: formData.get('createPaymentLink') === 'on',
		sendEmail: formData.get('sendEmail') === 'on',
	}
	const res = await quotationFetch('/v1/erp/quotations', tenant, {
		method: 'POST',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	const quotation = (await res.json()) as QuotationData
	revalidatePath(`/${tenant}/quotations`)
	redirect(`/${tenant}/quotations/${quotation.id}`)
}

export async function updateQuotationAction(
	tenant: string,
	id: string,
	formData: FormData,
) {
	const body = {
		status: String(formData.get('status') || 'Draft'),
		sendEmail: formData.get('sendEmail') === 'on',
		createPaymentLink: formData.get('createPaymentLink') === 'on',
	}
	const res = await quotationFetch(`/v1/erp/quotations/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
	revalidatePath(`/${tenant}/quotations/${id}`)
	revalidatePath(`/${tenant}/quotations`)
}

export async function convertQuotationToInvoiceAction(
	tenant: string,
	id: string,
) {
	const res = await quotationFetch(
		`/v1/erp/quotations/${id}/convert-to-invoice`,
		tenant,
		{ method: 'POST' },
	)
	if (!res.ok) {
		throw new Error(await res.text())
	}
	const invoice = (await res.json()) as { id?: string; invoiceId?: string }
	const invoiceId = invoice.id ?? invoice.invoiceId
	revalidatePath(`/${tenant}/quotations/${id}`)
	revalidatePath(`/${tenant}/invoices`)
	redirect(
		invoiceId ? `/${tenant}/invoices/${invoiceId}` : `/${tenant}/invoices`,
	)
}
