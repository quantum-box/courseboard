'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { revalidatePath } from 'next/cache'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type SquarePaymentReconciliation = {
	id: string
	tenantId: string
	squarePaymentId: string
	squareEventId?: string | null
	amount: number
	currency: string
	payerHint?: string | null
	receivedAt: string
	status: 'Unmatched' | 'Matched' | 'Ignored'
	matchedInvoiceId?: string | null
	matchReason?: string | null
	receiptEmailSentAt?: string | null
	createdAt: string
	updatedAt: string
}

export type InvoiceCandidate = {
	id: string
	invoiceNumber: string
	clientId: string
	clientName?: string | null
	status: 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'
	currency: string
	totalAmount: number
	dueDate: string
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

export async function fetchSquarePaymentReconciliationsAction(
	tenant: string,
	status = 'Unmatched',
): Promise<ActionResult<SquarePaymentReconciliation[]>> {
	const search = new URLSearchParams({ status, limit: '100' })
	const res = await erpFetch(
		`/v1/invoice-reconciliations/square-payments?${search}`,
		tenant,
	).catch(error => {
		console.error('Failed to fetch square payment reconciliations:', error)
		return null
	})
	if (!res) {
		return { success: false, message: 'Square 入金消込を取得できませんでした' }
	}
	if (!res.ok) {
		return { success: false, message: await res.text() }
	}
	const data = (await res.json()) as {
		items: SquarePaymentReconciliation[]
	}
	return { success: true, data: data.items }
}

async function fetchInvoicesByStatus(
	tenant: string,
	status: InvoiceCandidate['status'],
) {
	const search = new URLSearchParams({ status, limit: '100' })
	const res = await erpFetch(`/v1/invoices?${search}`, tenant).catch(error => {
		console.error(`Failed to fetch ${status} invoices:`, error)
		return null
	})
	if (!res) return []
	if (!res.ok) return []
	const data = (await res.json()) as { items: InvoiceCandidate[] }
	return data.items
}

export async function fetchInvoiceCandidatesAction(
	tenant: string,
): Promise<ActionResult<InvoiceCandidate[]>> {
	const [sent, overdue, draft] = await Promise.all([
		fetchInvoicesByStatus(tenant, 'Sent'),
		fetchInvoicesByStatus(tenant, 'Overdue'),
		fetchInvoicesByStatus(tenant, 'Draft'),
	])
	return { success: true, data: [...sent, ...overdue, ...draft] }
}

export async function reconcileSquarePaymentAction(
	tenant: string,
	formData: FormData,
) {
	const squarePaymentId = String(formData.get('squarePaymentId') || '')
	const invoiceId = String(formData.get('invoiceId') || '')
	const note = String(formData.get('note') || '') || undefined
	const res = await erpFetch(
		`/v1/invoice-reconciliations/square-payments/${encodeURIComponent(
			squarePaymentId,
		)}/reconcile`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({ invoiceId, note }),
		},
	)
	if (!res.ok) {
		throw new Error(await res.text())
	}
	revalidatePath(`/${tenant}/accounting/revenue-reconciliation`)
	revalidatePath(`/${tenant}/dashboard`)
	revalidatePath(`/${tenant}/invoices`)
}
