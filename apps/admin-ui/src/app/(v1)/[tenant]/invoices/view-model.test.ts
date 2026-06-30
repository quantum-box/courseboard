import { describe, expect, it } from 'vitest'
import type { InvoiceData } from './action'
import { summarizeInvoices } from './view-model'

const baseInvoice: InvoiceData = {
	id: 'inv_1',
	tenantId: 'tn_1',
	invoiceNumber: 'INV-1',
	clientId: 'client_1',
	lineItems: [],
	dueDate: '2026-05-31',
	status: 'Draft',
	currency: 'JPY',
	subtotalAmount: 1000,
	taxAmount: 100,
	totalAmount: 1100,
	createdAt: '2026-05-01T00:00:00Z',
	updatedAt: '2026-05-01T00:00:00Z',
}

describe('summarizeInvoices', () => {
	it('separates unpaid, overdue, and paid invoice amounts', () => {
		const summary = summarizeInvoices([
			baseInvoice,
			{
				...baseInvoice,
				id: 'inv_2',
				status: 'Overdue',
				totalAmount: 2200,
			},
			{
				...baseInvoice,
				id: 'inv_3',
				status: 'Paid',
				totalAmount: 3300,
			},
		])

		expect(summary).toEqual({
			totalCount: 3,
			totalAmount: 6600,
			unpaidCount: 2,
			unpaidAmount: 3300,
			overdueCount: 1,
			paidAmount: 3300,
		})
	})

	it('counts send-failed invoices as unpaid', () => {
		const summary = summarizeInvoices([
			{
				...baseInvoice,
				status: 'SendFailed',
				totalAmount: 2200,
			},
		])

		expect(summary.unpaidCount).toBe(1)
		expect(summary.unpaidAmount).toBe(2200)
		expect(summary.paidAmount).toBe(0)
	})
})
