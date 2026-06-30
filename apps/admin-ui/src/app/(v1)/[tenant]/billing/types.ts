export type ActionResult<T> = {
	success: boolean
	message?: string
	statusCode?: number
	data?: T
}

export type BillingFollowUpStatus =
	| 'not_started'
	| 'contacted'
	| 'payment_promised'
	| 'escalated'
	| 'disputed'
	| 'resolved'

export type InvoiceItem = {
	id: string
	invoiceNumber: string
	clientId: string
	clientName?: string | null
	clientEmail?: string | null
	status: 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'
	currency: string
	totalAmount: number
	dueDate: string
	paymentLinkUrl?: string | null
	notes?: string | null
	paidAt?: string | null
	updatedAt: string
	createdAt: string
}

export type BillingQueueItem = {
	id: string
	kind:
		| 'unpaid_invoice'
		| 'overdue_invoice'
		| 'partially_paid'
		| 'payment_link'
		| 'ar_receivable'
		| 'reconciliation_exception'
	sourceType: 'invoice' | 'ar_receivable' | 'square_reconciliation'
	sourceId: string
	invoiceId?: string | null
	squarePaymentId?: string | null
	title: string
	counterparty?: string | null
	status: string
	followUpStatus?: BillingFollowUpStatus
	amount: number
	currency: string
	settledAmount?: number
	outstandingAmount?: number
	dueDate?: string | null
	eventDate?: string | null
	href: string
	reconciliationHref?: string | null
	paymentLinkUrl?: string | null
	actionLabel: string
	detail?: string | null
	severity: 'normal' | 'warning' | 'critical'
	canResendPaymentLink: boolean
	canUpdateFollowUp: boolean
}
