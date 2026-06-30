export type SalesLedgerFormState = {
	registerClosedAt: string
	productName: string
	quantity: string
	unitPrice: string
	totalAmount: string
	paymentMethod: string
	status: string
	notes: string
}

function normalizeNumberString(value: string) {
	return value
		.replace(/[０-９]/g, char =>
			String.fromCharCode(char.charCodeAt(0) - 0xfee0),
		)
		.replace(/[,\s円¥￥]/g, '')
}

function numberFrom(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.round(value)
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(normalizeNumberString(value.trim()))
		if (Number.isFinite(parsed)) {
			return Math.round(parsed)
		}
	}
	return null
}

function pickString(
	record: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = record[key]
		if (typeof value === 'string' && value.trim() !== '') {
			return value.trim()
		}
	}
	return null
}

export function normalizePaymentMethod(value: unknown): string {
	const raw = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '_')

	if (!raw) return 'cash'
	if (raw.includes('credit') || raw.includes('card') || raw.includes('visa')) {
		return 'credit_card'
	}
	if (raw.includes('カード') || raw.includes('クレジット')) {
		return 'credit_card'
	}
	if (raw.includes('ic') || raw.includes('交通') || raw.includes('suica')) {
		return 'ic_card'
	}
	if (raw.includes('qr') || raw.includes('paypay') || raw.includes('line')) {
		return 'qr_code'
	}
	if (raw.includes('cash') || raw.includes('現金')) {
		return 'cash'
	}
	if (['cash', 'credit_card', 'ic_card', 'qr_code', 'other'].includes(raw)) {
		return raw
	}
	return 'other'
}

export function ocrDateTimeToLocal(value: string): string | null {
	const normalized = value
		.trim()
		.replace(/[０-９]/g, char =>
			String.fromCharCode(char.charCodeAt(0) - 0xfee0),
		)
		.replace(/年|月/g, '-')
		.replace(/日/g, '')
	if (!normalized) return null

	const match = normalized.match(
		/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2}))?/,
	)
	if (!match) return null

	const [, year, month, day, hour, minute] = match
	const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
	if (hour != null && minute != null) {
		return `${date}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
	}
	return `${date}T12:00`
}

function resolveRegisterClosedAt(
	extracted: Record<string, unknown>,
): string | null {
	const closedAt = pickString(extracted, [
		'register_closed_at',
		'registerClosedAt',
		'closed_at',
		'closedAt',
	])
	if (closedAt) {
		return ocrDateTimeToLocal(closedAt)
	}
	const date = pickString(extracted, ['date'])
	if (date) {
		return ocrDateTimeToLocal(date)
	}
	return null
}

function resolveNotes(extracted: Record<string, unknown>): string {
	const storeName = pickString(extracted, ['store_name', 'storeName'])
	if (!storeName) return ''
	return `取引先: ${storeName}`
}

function resolveLineItemFields(
	extracted: Record<string, unknown>,
	total: number | null,
) {
	const items = Array.isArray(extracted.items)
		? extracted.items.filter(
				(item): item is Record<string, unknown> =>
					typeof item === 'object' && item !== null,
			)
		: []

	if (items.length === 1) {
		const item = items[0]
		const quantity = numberFrom(item.quantity) ?? numberFrom(item.count) ?? 1
		const amount =
			numberFrom(item.amount) ??
			numberFrom(item.total) ??
			numberFrom(item.totalAmount) ??
			total ??
			numberFrom(item.unit_price) ??
			numberFrom(item.unitPrice) ??
			0
		const unitPrice =
			numberFrom(item.unit_price) ??
			numberFrom(item.unitPrice) ??
			(quantity > 0 ? Math.round(amount / quantity) : amount)

		return {
			productName:
				pickString(item, [
					'name',
					'product_name',
					'productName',
					'item_name',
				]) ?? 'レシート売上',
			quantity: String(Math.max(quantity, 1)),
			unitPrice: String(Math.max(unitPrice, 0)),
			totalAmount: String(Math.max(amount, 0)),
		}
	}

	if (items.length > 1) {
		const resolvedTotal = total ?? 0
		return {
			productName: `レシート売上（${items.length}品目）`,
			quantity: '1',
			unitPrice: String(Math.max(resolvedTotal, 0)),
			totalAmount: String(Math.max(resolvedTotal, 0)),
		}
	}

	const resolvedTotal = total ?? 0
	return {
		productName: 'レシート売上',
		quantity: '1',
		unitPrice: String(Math.max(resolvedTotal, 0)),
		totalAmount: String(Math.max(resolvedTotal, 0)),
	}
}

export function mapOcrToSalesLedgerForm(
	extracted: Record<string, unknown>,
	fallbackRegisterClosedAt: string,
): SalesLedgerFormState {
	const total =
		numberFrom(extracted.total) ??
		numberFrom(extracted.totalAmount) ??
		numberFrom(extracted.total_amount) ??
		numberFrom(extracted.grand_total)
	const lineItem = resolveLineItemFields(extracted, total)

	return {
		registerClosedAt:
			resolveRegisterClosedAt(extracted) ?? fallbackRegisterClosedAt,
		productName: lineItem.productName,
		quantity: lineItem.quantity,
		unitPrice: lineItem.unitPrice,
		totalAmount: lineItem.totalAmount,
		paymentMethod: normalizePaymentMethod(
			extracted.payment_method ?? extracted.paymentMethod,
		),
		status: 'draft',
		notes: resolveNotes(extracted),
	}
}
