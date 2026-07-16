export type InvoiceStatus = 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'

export type InvoiceLineItem = {
	description: string
	quantity: number
	unitPrice: number
	amount: number
	taxCategory?: string
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
