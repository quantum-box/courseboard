'use server'

import { authWithCheck } from 'app/auth'
import { backendMutationFailureFromResponse } from 'lib/backend-mutation-error'
import { getRuntimeEnv } from 'lib/runtime-env'
import { joinServerBackendPath } from 'lib/serverBackendUrl'
import type {
	ActionResult,
	BillingFollowUpStatus,
	BillingQueueItem,
	InvoiceItem,
} from './types'

const DEFAULT_PLATFORM_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

type InvoiceStatus = 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'

type ArApSummary = {
	receivableTotal: number
	receivableOutstanding: number
	receivableOverdue: number
	payableTotal: number
	payableOutstanding: number
	payableOverdue: number
}

type ArApItem = {
	id: string
	kind: 'receivable' | 'payable'
	sourceType: string
	sourceId: string
	sourceNumber?: string | null
	counterpartyName: string
	dueDate: string
	currency: string
	totalAmount: number
	settledAmount: number
	outstandingAmount: number
	effectiveStatus: string
	daysOverdue: number
}

type SquarePaymentReconciliation = {
	id: string
	squarePaymentId: string
	amount: number
	currency: string
	payerHint?: string | null
	receivedAt: string
	status: 'Unmatched' | 'Matched' | 'Ignored'
	matchedInvoiceId?: string | null
	matchReason?: string | null
}

export type BillingCenterData = {
	summary: {
		unpaidInvoiceCount: number
		unpaidInvoiceAmount: number
		overdueInvoiceCount: number
		overdueInvoiceAmount: number
		receivableOutstanding: number
		receivableOverdue: number
		paymentLinkCount: number
		reconciliationExceptionCount: number
	}
	queue: BillingQueueItem[]
	errors: string[]
	fetchedAt: string
}

async function apiFetchJson<T>(
	path: string,
	tenantId: string,
): Promise<ActionResult<T>> {
	const session = await authWithCheck()
	try {
		const response = await fetch(joinServerBackendPath(path), {
			headers: {
				'Content-Type': 'application/json',
				'x-platform-id':
					getRuntimeEnv('NEXT_PUBLIC_PLATFORM_ID') ?? DEFAULT_PLATFORM_ID,
				'x-operator-id': tenantId,
				Authorization: `Bearer ${session.accessToken}`,
			},
		})

		if (!response.ok) {
			const failure = await backendMutationFailureFromResponse(
				response,
				'請求データの取得に失敗しました',
			)
			return {
				success: false,
				message: failure.message,
				statusCode: failure.status,
			}
		}

		return { success: true, data: (await response.json()) as T }
	} catch (error) {
		return {
			success: false,
			message:
				error instanceof Error ? error.message : 'Failed to fetch billing data',
		}
	}
}

async function apiMutateJson<T>(
	path: string,
	tenantId: string,
	body: Record<string, unknown>,
): Promise<ActionResult<T>> {
	const session = await authWithCheck()
	try {
		const response = await fetch(joinServerBackendPath(path), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-platform-id':
					getRuntimeEnv('NEXT_PUBLIC_PLATFORM_ID') ?? DEFAULT_PLATFORM_ID,
				'x-operator-id': tenantId,
				Authorization: `Bearer ${session.accessToken}`,
			},
			body: JSON.stringify(body),
		})

		if (!response.ok) {
			const failure = await backendMutationFailureFromResponse(
				response,
				'送信系操作に失敗しました',
			)
			return {
				success: false,
				message: failure.message,
				statusCode: failure.status,
			}
		}

		return { success: true, data: (await response.json()) as T }
	} catch (error) {
		return {
			success: false,
			message:
				error instanceof Error
					? error.message
					: 'Failed to update billing data',
		}
	}
}

function today() {
	return new Date().toISOString().slice(0, 10)
}

async function fetchInvoicesByStatus(tenantId: string, status: InvoiceStatus) {
	const params = new URLSearchParams({ status, limit: '100' })
	return apiFetchJson<{ items: InvoiceItem[] }>(
		`/v1/invoices?${params.toString()}`,
		tenantId,
	)
}

function invoiceSeverity(invoice: InvoiceItem): BillingQueueItem['severity'] {
	if (invoice.status === 'Overdue') return 'critical'
	if (invoice.dueDate < today()) return 'critical'
	return 'warning'
}

function invoiceQueueKind(invoice: InvoiceItem): BillingQueueItem['kind'] {
	return invoice.status === 'Overdue' || invoice.dueDate < today()
		? 'overdue_invoice'
		: 'unpaid_invoice'
}

function invoiceReconciliationHref(invoiceId: string) {
	return `/accounting/revenue-reconciliation?${new URLSearchParams({
		sourceId: invoiceId,
		sourceType: 'invoice',
	})}`
}

function squareReconciliationHref(squarePaymentId: string) {
	return `/accounting/revenue-reconciliation?${new URLSearchParams({
		sourceId: squarePaymentId,
		sourceType: 'square_payment',
	})}`
}

function followUpStatusFromNotes(
	notes?: string | null,
): BillingFollowUpStatus | undefined {
	let latest: BillingFollowUpStatus | undefined
	const pattern = /\[billing-follow-up status=([a-z_]+)/g
	let match = notes ? pattern.exec(notes) : null
	while (match) {
		latest = match[1] as BillingFollowUpStatus
		match = pattern.exec(notes ?? '')
	}
	return latest
}

export async function fetchBillingCenterAction(
	tenantId: string,
): Promise<ActionResult<BillingCenterData>> {
	const asOf = today()
	const [sent, overdue, draft, arSummary, arItems, squareExceptions] =
		await Promise.all([
			fetchInvoicesByStatus(tenantId, 'Sent'),
			fetchInvoicesByStatus(tenantId, 'Overdue'),
			fetchInvoicesByStatus(tenantId, 'Draft'),
			apiFetchJson<ArApSummary>(
				`/v1/erp/ar-ap/summary?${new URLSearchParams({ as_of: asOf })}`,
				tenantId,
			),
			apiFetchJson<{ items: ArApItem[] }>(
				`/v1/erp/ar-ap/items?${new URLSearchParams({
					as_of: asOf,
					kind: 'receivable',
				})}`,
				tenantId,
			),
			apiFetchJson<{ items: SquarePaymentReconciliation[] }>(
				`/v1/invoice-reconciliations/square-payments?${new URLSearchParams({
					status: 'Unmatched',
					limit: '100',
				})}`,
				tenantId,
			),
		])

	const errors = [
		['送付済請求', sent],
		['期限超過請求', overdue],
		['下書き請求', draft],
		['AR集計', arSummary],
		['AR明細', arItems],
		['Square照合例外', squareExceptions],
	]
		.filter(([, result]) => !(result as ActionResult<unknown>).success)
		.map(
			([label, result]) =>
				`${label}: ${(result as ActionResult<unknown>).message ?? '取得失敗'}`,
		)

	const invoices = [...(sent.data?.items ?? []), ...(overdue.data?.items ?? [])]
	const draftInvoices = draft.data?.items ?? []
	const receivables = (arItems.data?.items ?? []).filter(
		item => item.outstandingAmount > 0,
	)
	const unmatchedPayments = squareExceptions.data?.items ?? []

	const invoiceQueue: BillingQueueItem[] = invoices.map(invoice => ({
		id: `invoice-${invoice.id}`,
		kind: invoiceQueueKind(invoice),
		sourceType: 'invoice',
		sourceId: invoice.id,
		invoiceId: invoice.id,
		title: invoice.invoiceNumber,
		counterparty: invoice.clientName ?? invoice.clientId,
		status: invoice.status,
		followUpStatus: followUpStatusFromNotes(invoice.notes),
		amount: invoice.totalAmount,
		currency: invoice.currency,
		dueDate: invoice.dueDate,
		eventDate: invoice.updatedAt ?? invoice.createdAt,
		href: `/invoices/${invoice.id}`,
		reconciliationHref: invoiceReconciliationHref(invoice.id),
		paymentLinkUrl: invoice.paymentLinkUrl,
		actionLabel: invoice.paymentLinkUrl ? '支払リンクを開く' : '請求詳細',
		detail: invoice.paymentLinkUrl
			? '支払リンクあり'
			: '支払リンク未作成または未連携',
		severity: invoiceSeverity(invoice),
		canResendPaymentLink: Boolean(invoice.paymentLinkUrl),
		canUpdateFollowUp: true,
	}))

	const paymentLinkQueue: BillingQueueItem[] = [...invoices, ...draftInvoices]
		.filter(invoice => invoice.paymentLinkUrl && invoice.status !== 'Paid')
		.map(invoice => ({
			id: `payment-link-${invoice.id}`,
			kind: 'payment_link',
			sourceType: 'invoice',
			sourceId: invoice.id,
			invoiceId: invoice.id,
			title: invoice.invoiceNumber,
			counterparty: invoice.clientName ?? invoice.clientId,
			status: invoice.status,
			followUpStatus: followUpStatusFromNotes(invoice.notes),
			amount: invoice.totalAmount,
			currency: invoice.currency,
			dueDate: invoice.dueDate,
			eventDate: invoice.updatedAt ?? invoice.createdAt,
			href: `/invoices/${invoice.id}`,
			reconciliationHref: invoiceReconciliationHref(invoice.id),
			paymentLinkUrl: invoice.paymentLinkUrl,
			actionLabel: '支払リンク確認',
			detail: invoice.paymentLinkUrl,
			severity:
				invoice.status === 'Draft' ? 'normal' : invoiceSeverity(invoice),
			canResendPaymentLink: true,
			canUpdateFollowUp: true,
		}))

	const arQueue: BillingQueueItem[] = receivables.map(item => ({
		id: `ar-${item.id}`,
		kind:
			item.settledAmount > 0 && item.outstandingAmount > 0
				? 'partially_paid'
				: 'ar_receivable',
		sourceType: 'ar_receivable',
		sourceId: item.id,
		invoiceId: item.sourceType === 'invoice' ? item.sourceId : null,
		title: item.sourceNumber ?? item.sourceId,
		counterparty: item.counterpartyName,
		status: item.effectiveStatus,
		amount: item.outstandingAmount,
		currency: item.currency,
		settledAmount: item.settledAmount,
		outstandingAmount: item.outstandingAmount,
		dueDate: item.dueDate,
		href:
			item.sourceType === 'invoice'
				? `/invoices/${item.sourceId}`
				: `/erp/ar-ap?itemId=${item.id}`,
		reconciliationHref: `/erp/ar-ap?itemId=${item.id}`,
		actionLabel: 'AR詳細',
		detail:
			item.daysOverdue > 0
				? `${item.daysOverdue}日超過`
				: item.settledAmount > 0
					? `一部入金済: ${item.settledAmount.toLocaleString('ja-JP')}`
					: `発生元: ${item.sourceType}`,
		severity: item.daysOverdue > 0 ? 'critical' : 'warning',
		canResendPaymentLink: false,
		canUpdateFollowUp: item.sourceType === 'invoice',
	}))

	const reconciliationQueue: BillingQueueItem[] = unmatchedPayments.map(
		item => ({
			id: `square-${item.id}`,
			kind: 'reconciliation_exception',
			sourceType: 'square_reconciliation',
			sourceId: item.id,
			squarePaymentId: item.squarePaymentId,
			invoiceId: item.matchedInvoiceId,
			title: item.squarePaymentId,
			counterparty: item.payerHint,
			status: item.status,
			amount: item.amount,
			currency: item.currency,
			eventDate: item.receivedAt,
			href: squareReconciliationHref(item.squarePaymentId),
			reconciliationHref: squareReconciliationHref(item.squarePaymentId),
			actionLabel: '消込へ',
			detail: item.matchReason ?? 'Square入金が請求書に未消込です',
			severity: 'critical',
			canResendPaymentLink: false,
			canUpdateFollowUp: false,
		}),
	)

	const queue = [
		...reconciliationQueue,
		...arQueue,
		...invoiceQueue,
		...paymentLinkQueue,
	].sort((a, b) => {
		const severityOrder = { critical: 0, warning: 1, normal: 2 }
		const severityDelta = severityOrder[a.severity] - severityOrder[b.severity]
		if (severityDelta !== 0) return severityDelta
		return (a.dueDate ?? a.eventDate ?? '').localeCompare(
			b.dueDate ?? b.eventDate ?? '',
		)
	})

	const unpaidInvoices = invoices.filter(invoice => invoice.status !== 'Paid')
	const overdueInvoices = invoices.filter(
		invoice => invoice.status === 'Overdue' || invoice.dueDate < asOf,
	)

	return {
		success: true,
		data: {
			errors,
			fetchedAt: new Date().toISOString(),
			queue,
			summary: {
				unpaidInvoiceCount: unpaidInvoices.length,
				unpaidInvoiceAmount: unpaidInvoices.reduce(
					(sum, invoice) => sum + invoice.totalAmount,
					0,
				),
				overdueInvoiceCount: overdueInvoices.length,
				overdueInvoiceAmount: overdueInvoices.reduce(
					(sum, invoice) => sum + invoice.totalAmount,
					0,
				),
				receivableOutstanding: arSummary.data?.receivableOutstanding ?? 0,
				receivableOverdue: arSummary.data?.receivableOverdue ?? 0,
				paymentLinkCount: paymentLinkQueue.length,
				reconciliationExceptionCount: unmatchedPayments.length,
			},
		},
	}
}

export async function resendPaymentLinkAction(
	tenantId: string,
	invoiceId: string,
): Promise<ActionResult<InvoiceItem>> {
	return apiMutateJson<InvoiceItem>(
		`/v1/invoices/${invoiceId}/payment-link/resend`,
		tenantId,
		{ paymentLinkProvider: 'stripe', sendEmail: true },
	)
}

export async function updateFollowUpStatusAction(
	tenantId: string,
	invoiceId: string,
	status: BillingFollowUpStatus,
	note?: string,
): Promise<ActionResult<InvoiceItem>> {
	return apiMutateJson<InvoiceItem>(
		`/v1/invoices/${invoiceId}/follow-up-status`,
		tenantId,
		{ status, note },
	)
}
