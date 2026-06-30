export type Customer360Kind =
	| 'deal'
	| 'quotation'
	| 'order'
	| 'consumerOrder'
	| 'reservation'
	| 'invoice'
	| 'cancellationFee'
	| 'arAp'
	| 'evidence'
	| 'auditReference'

export type Customer360TimelineItem = {
	id: string
	kind: Customer360Kind
	title: string
	description?: string | null
	status?: string | null
	amount?: string | null
	date?: string | null
	path: string
}

export type Customer360Section = {
	key: Customer360Kind
	title: string
	items: Customer360TimelineItem[]
	error?: string
}

export type Customer360Data = {
	sections: Customer360Section[]
	fetchedAt: string
}

export type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

export type DealItem = {
	id: string
	name: string
	amount?: string | null
	stage?: string | null
	pipeline?: string | null
	updatedAt?: string | null
	createdAt?: string | null
}

export type QuotationItem = {
	id: string
	quotationNumber: string
	status: string
	totalAmount: number
	validUntil?: string | null
	updatedAt?: string | null
	createdAt?: string | null
}

export type OrderItem = {
	id: string
	orderNumber: string
	status: string
	totalAmount: number
	updatedAt?: string | null
	createdAt?: string | null
}

export type ConsumerOrderItem = {
	id: string
	status: string
	fulfillmentMethod?: string | null
	fulfillment_method?: string | null
	customerName?: string | null
	customer_name?: string | null
	customerEmail?: string | null
	customer_email?: string | null
	totalNanodollar?: number | string
	total_nanodollar?: number | string
	confirmedAt?: string | null
	confirmed_at?: string | null
	cancelledAt?: string | null
	cancelled_at?: string | null
	createdAt?: string | null
	created_at?: string | null
	updatedAt?: string | null
	updated_at?: string | null
}

export type ReservationItem = {
	id: string
	reservationNumber: string
	status: string
	paymentStatus?: string | null
	startsAt?: string | null
	endsAt?: string | null
	priceAmount?: number | null
}

export type InvoiceLineItem = {
	description: string
}

export type InvoiceItem = {
	id: string
	invoiceNumber: string
	status: string
	currency?: string | null
	totalAmount: number
	dueDate?: string | null
	paidAt?: string | null
	updatedAt?: string | null
	createdAt?: string | null
	lineItems?: InvoiceLineItem[] | null
	notes?: string | null
}

export type ArApItem = {
	id: string
	kind: 'receivable' | 'payable' | string
	sourceType: string
	sourceId: string
	sourceNumber?: string | null
	dueDate: string
	currency: string
	totalAmount: number
	settledAmount: number
	outstandingAmount: number
	effectiveStatus: string
	daysOverdue: number
}

export type EvidenceSearchItem = {
	evidence: {
		id: string
		voucherType: string
		documentNumber?: string | null
		status: string
		verificationStatus: string
		transactionDate?: string | null
		amount?: string | null
		currency?: string | null
	}
}

export type AuditLogItem = {
	id: string
	resourceType?: string
	resource_type?: string
	resourceId?: string
	resource_id?: string
	action: string
	createdAt?: string
	created_at?: string
	actorType?: string | null
	actor_type?: string | null
}

export type Customer360Sources = {
	deals: ActionResult<{ items: DealItem[] }>
	quotations: ActionResult<{ items: QuotationItem[] }>
	orders: ActionResult<{ items: OrderItem[] }>
	consumerOrders: ActionResult<{ items: ConsumerOrderItem[] }>
	reservations: ActionResult<{ items: ReservationItem[] }>
	invoices: ActionResult<{ items: InvoiceItem[] }>
	arAp: ActionResult<{ items: ArApItem[] }>
	evidence: ActionResult<{ items: EvidenceSearchItem[] }>
	auditReferences: ActionResult<{ items: AuditLogItem[] }>
}

export function formatCurrency(value?: number | string | null, currency = 'JPY') {
	if (value === null || value === undefined || value === '') {
		return null
	}
	const numericValue = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(numericValue)) {
		return String(value)
	}
	return new Intl.NumberFormat('ja-JP', {
		currency,
		style: 'currency',
		maximumFractionDigits: 0,
	}).format(numericValue)
}

function formatNanodollarAsCurrency(value: number | string) {
	const numericValue = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(numericValue)) {
		return String(value)
	}
	return formatCurrency(numericValue / 1_000_000_000, 'USD')
}

function section(
	key: Customer360Kind,
	title: string,
	items: Customer360TimelineItem[],
	error?: string,
): Customer360Section {
	return { key, title, items, error }
}

function errorMessage(result: ActionResult<unknown>) {
	return result.success ? undefined : result.message ?? '取得失敗'
}

function isCancellationFee(invoice: InvoiceItem) {
	const text = [
		invoice.notes,
		...(invoice.lineItems ?? []).map(item => item.description),
	]
		.filter(Boolean)
		.join('\n')
		.toLowerCase()
	return text.includes('キャンセル料') || text.includes('cancellation fee')
}

function sourcePath(item: ArApItem) {
	switch (item.sourceType) {
		case 'invoice':
			return `/invoices/${item.sourceId}`
		case 'order':
			return `/orders/${item.sourceId}`
		case 'quotation':
			return `/quotations/${item.sourceId}`
		default:
			return `/erp/ar-ap?sourceType=${encodeURIComponent(item.sourceType)}&sourceId=${encodeURIComponent(item.sourceId)}`
	}
}

function auditResourceType(item: AuditLogItem) {
	return item.resourceType ?? item.resource_type ?? 'unknown'
}

function auditResourceId(item: AuditLogItem) {
	return item.resourceId ?? item.resource_id ?? item.id
}

function consumerOrderTotal(item: ConsumerOrderItem) {
	return item.totalNanodollar ?? item.total_nanodollar ?? 0
}

export function buildCustomer360Data(
	sources: Customer360Sources,
	fetchedAt = new Date().toISOString(),
): Customer360Data {
	const invoices = sources.invoices.data?.items ?? []
	const cancellationFees = invoices.filter(isCancellationFee)
	const regularInvoices = invoices.filter(invoice => !isCancellationFee(invoice))

	return {
		fetchedAt,
		sections: [
			section(
				'deal',
				'商談',
				(sources.deals.data?.items ?? []).map(item => ({
					id: item.id,
					kind: 'deal',
					title: item.name,
					description: item.pipeline ? `Pipeline: ${item.pipeline}` : null,
					status: item.stage,
					amount: formatCurrency(item.amount),
					date: item.updatedAt ?? item.createdAt,
					path: `/deals/${item.id}`,
				})),
				errorMessage(sources.deals),
			),
			section(
				'quotation',
				'見積',
				(sources.quotations.data?.items ?? []).map(item => ({
					id: item.id,
					kind: 'quotation',
					title: item.quotationNumber,
					description: item.validUntil ? `有効期限 ${item.validUntil}` : null,
					status: item.status,
					amount: formatCurrency(item.totalAmount),
					date: item.updatedAt ?? item.createdAt ?? item.validUntil,
					path: `/quotations/${item.id}`,
				})),
				errorMessage(sources.quotations),
			),
			section(
				'order',
				'受注',
				(sources.orders.data?.items ?? []).map(item => ({
					id: item.id,
					kind: 'order',
					title: item.orderNumber,
					status: item.status,
					amount: formatCurrency(item.totalAmount),
					date: item.updatedAt ?? item.createdAt,
					path: `/orders/${item.id}`,
				})),
				errorMessage(sources.orders),
			),
			section(
				'consumerOrder',
				'EC受注',
				(sources.consumerOrders.data?.items ?? []).map(item => ({
					id: item.id,
					kind: 'consumerOrder',
					title: item.id,
					description:
						item.fulfillmentMethod ??
						item.fulfillment_method ??
						item.customerName ??
						item.customer_name ??
						item.customerEmail ??
						item.customer_email ??
						'StoreKit order',
					status: item.status,
					amount: formatNanodollarAsCurrency(consumerOrderTotal(item)),
					date:
						item.confirmedAt ??
						item.confirmed_at ??
						item.cancelledAt ??
						item.cancelled_at ??
						item.updatedAt ??
						item.updated_at ??
						item.createdAt ??
						item.created_at,
					path: `/consumer-orders/${item.id}`,
				})),
				errorMessage(sources.consumerOrders),
			),
			section(
				'reservation',
				'予約',
				(sources.reservations.data?.items ?? []).map(item => ({
					id: item.id,
					kind: 'reservation',
					title: item.reservationNumber,
					description: item.paymentStatus
						? `Payment: ${item.paymentStatus}`
						: null,
					status: item.status,
					amount: formatCurrency(item.priceAmount),
					date: item.startsAt,
					path: `/reservations?reservationId=${encodeURIComponent(item.id)}`,
				})),
				errorMessage(sources.reservations),
			),
			section(
				'invoice',
				'請求',
				regularInvoices.map(item => ({
					id: item.id,
					kind: 'invoice',
					title: item.invoiceNumber,
					description: item.dueDate ? `支払期限 ${item.dueDate}` : null,
					status: item.status,
					amount: formatCurrency(item.totalAmount, item.currency ?? 'JPY'),
					date: item.paidAt ?? item.updatedAt ?? item.createdAt ?? item.dueDate,
					path: `/invoices/${item.id}`,
				})),
				errorMessage(sources.invoices),
			),
			section(
				'cancellationFee',
				'キャンセル料',
				cancellationFees.map(item => ({
					id: item.id,
					kind: 'cancellationFee',
					title: item.invoiceNumber,
					description: item.dueDate ? `支払期限 ${item.dueDate}` : null,
					status: item.status,
					amount: formatCurrency(item.totalAmount, item.currency ?? 'JPY'),
					date: item.paidAt ?? item.updatedAt ?? item.createdAt ?? item.dueDate,
					path: `/invoices/${item.id}`,
				})),
				errorMessage(sources.invoices),
			),
			section(
				'arAp',
				'AR/AP',
				(sources.arAp.data?.items ?? []).map(item => ({
					id: item.id,
					kind: 'arAp',
					title: item.sourceNumber ?? item.sourceId,
					description:
						item.daysOverdue > 0
							? `${item.daysOverdue}日超過`
							: `発生元: ${item.sourceType}`,
					status: item.effectiveStatus,
					amount: formatCurrency(item.outstandingAmount, item.currency),
					date: item.dueDate,
					path: sourcePath(item),
				})),
				errorMessage(sources.arAp),
			),
			section(
				'evidence',
				'証憑',
				(sources.evidence.data?.items ?? []).map(item => ({
					id: item.evidence.id,
					kind: 'evidence',
					title:
						item.evidence.documentNumber ||
						`${item.evidence.voucherType} ${item.evidence.id}`,
					description: item.evidence.verificationStatus,
					status: item.evidence.status,
					amount: formatCurrency(
						item.evidence.amount,
						item.evidence.currency ?? 'JPY',
					),
					date: item.evidence.transactionDate,
					path: `/erp/evidence/${item.evidence.id}`,
				})),
				errorMessage(sources.evidence),
			),
			section(
				'auditReference',
				'監査参照',
				(sources.auditReferences.data?.items ?? []).map(item => ({
					id: item.id,
					kind: 'auditReference',
					title: `${auditResourceType(item)}:${auditResourceId(item)}`,
					description:
						item.actorType || item.actor_type
							? `Actor: ${item.actorType ?? item.actor_type}`
							: null,
					status: item.action,
					date: item.createdAt ?? item.created_at,
					path: `/audit-logs?resourceType=${encodeURIComponent(auditResourceType(item))}&resourceId=${encodeURIComponent(auditResourceId(item))}`,
				})),
				errorMessage(sources.auditReferences),
			),
		],
	}
}
