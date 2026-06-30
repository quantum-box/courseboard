import { describe, expect, it } from 'vitest'
import type { OrderData } from './action'
import { summarizeOrderExceptionFlow } from './order-exception-summary'

const baseOrder: OrderData = {
	id: 'ord_1',
	tenantId: 'tn_1',
	orderNumber: 'ORD-1',
	clientId: 'client_1',
	items: [],
	status: 'Pending',
	source: 'manual',
	currency: 'JPY',
	subtotalAmount: 1000,
	taxAmount: 100,
	totalAmount: 1100,
	createdAt: '2026-05-01T00:00:00.000Z',
	updatedAt: '2026-05-01T00:00:00.000Z',
}

describe('summarizeOrderExceptionFlow', () => {
	it('keeps pre-shipment pending orders in the normal cancellation path', () => {
		const summary = summarizeOrderExceptionFlow(baseOrder)

		expect(summary.cancellationLabel).toBe('キャンセル可')
		expect(summary.returnLabel).toBe('通常キャンセル優先')
		expect(summary.inventoryLabel).toBe('在庫未反映')
		expect(summary.requiresOperatorReview).toBe(false)
	})

	it('marks shipped paid orders as review-required return/refund candidates', () => {
		const summary = summarizeOrderExceptionFlow({
			...baseOrder,
			status: 'Shipped',
			squarePaymentId: 'pay_1',
			inventoryDecrementedAt: '2026-05-02T00:00:00.000Z',
			convertedInvoiceId: 'inv_1',
		})

		expect(summary.cancellationLabel).toBe('要個別確認')
		expect(summary.returnLabel).toBe('返品候補')
		expect(summary.refundLabel).toBe('Square 決済あり')
		expect(summary.inventoryLabel).toBe('在庫反映済')
		expect(summary.requiresOperatorReview).toBe(true)
	})
})
