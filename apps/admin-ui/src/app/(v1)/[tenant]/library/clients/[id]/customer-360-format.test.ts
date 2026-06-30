import { describe, expect, it } from 'vitest'
import { buildCustomer360Data } from './customer-360-format'

const ok = { success: true as const, data: { items: [] } }

describe('buildCustomer360Data', () => {
	it('formats linked sales, billing, reservation, evidence, and audit activity', () => {
		const data = buildCustomer360Data(
			{
				deals: {
					success: true,
					data: {
						items: [
							{
								id: 'deal_1',
								name: '法人プラン更新',
								amount: '120000',
								stage: 'won',
								pipeline: 'enterprise',
								updatedAt: '2026-05-21T09:00:00Z',
							},
						],
					},
				},
				quotations: ok,
				orders: ok,
				consumerOrders: {
					success: true,
					data: {
						items: [
							{
								id: 'co_1',
								status: 'confirmed',
								fulfillmentMethod: 'pickup',
								totalNanodollar: 25000000000,
								confirmedAt: '2026-05-22T09:00:00Z',
							},
						],
					},
				},
				reservations: {
					success: true,
					data: {
						items: [
							{
								id: 'res_1',
								reservationNumber: 'RSV-1',
								status: 'confirmed',
								paymentStatus: 'paid',
								startsAt: '2026-05-23T01:00:00Z',
								priceAmount: 9000,
							},
						],
					},
				},
				invoices: {
					success: true,
					data: {
						items: [
							{
								id: 'inv_1',
								invoiceNumber: 'INV-1',
								status: 'Sent',
								totalAmount: 33000,
								currency: 'JPY',
								dueDate: '2026-05-31',
								createdAt: '2026-05-20T09:00:00Z',
								lineItems: [{ description: '月額利用料' }],
							},
							{
								id: 'inv_cancel',
								invoiceNumber: 'INV-CANCEL',
								status: 'Sent',
								totalAmount: 5000,
								currency: 'JPY',
								dueDate: '2026-05-25',
								createdAt: '2026-05-22T10:00:00Z',
								lineItems: [{ description: 'キャンセル料 (RSV-1)' }],
							},
						],
					},
				},
				arAp: {
					success: true,
					data: {
						items: [
							{
								id: 'arap_1',
								kind: 'receivable',
								sourceType: 'invoice',
								sourceId: 'inv_1',
								sourceNumber: 'INV-1',
								dueDate: '2026-05-31',
								currency: 'JPY',
								totalAmount: 33000,
								settledAmount: 10000,
								outstandingAmount: 23000,
								effectiveStatus: 'open',
								daysOverdue: 0,
							},
						],
					},
				},
				evidence: {
					success: true,
					data: {
						items: [
							{
								evidence: {
									id: 'evd_1',
									voucherType: 'invoice',
									documentNumber: 'DOC-1',
									status: 'active',
									verificationStatus: 'verified',
									transactionDate: '2026-05-20',
									amount: '33000',
									currency: 'JPY',
								},
							},
						],
					},
				},
				auditReferences: {
					success: true,
					data: {
						items: [
							{
								id: 'audit_1',
								resourceType: 'customer',
								resourceId: 'cl_1',
								action: 'erp:customers:update',
								actorType: 'operator',
								createdAt: '2026-05-22T11:00:00Z',
							},
						],
					},
				},
			},
			'2026-05-23T00:00:00Z',
		)

		expect(data.sections.map(section => section.key)).toEqual([
			'deal',
			'quotation',
			'order',
			'consumerOrder',
			'reservation',
			'invoice',
			'cancellationFee',
			'arAp',
			'evidence',
			'auditReference',
		])
		expect(data.sections.find(section => section.key === 'deal')?.items[0]).toMatchObject({
			amount: '￥120,000',
			path: '/deals/deal_1',
		})
		expect(
			data.sections.find(section => section.key === 'consumerOrder')?.items[0],
		).toMatchObject({
			amount: '$25',
			path: '/consumer-orders/co_1',
		})
		expect(data.sections.find(section => section.key === 'invoice')?.items).toHaveLength(1)
		expect(
			data.sections.find(section => section.key === 'cancellationFee')?.items[0],
		).toMatchObject({
			title: 'INV-CANCEL',
			path: '/invoices/inv_cancel',
		})
		expect(data.sections.find(section => section.key === 'arAp')?.items[0]).toMatchObject({
			amount: '￥23,000',
			path: '/invoices/inv_1',
		})
		expect(
			data.sections.find(section => section.key === 'auditReference')?.items[0],
		).toMatchObject({
			path: '/audit-logs?resourceType=customer&resourceId=cl_1',
		})
	})

	it('keeps empty sections distinct from failed sections', () => {
		const data = buildCustomer360Data({
			deals: ok,
			quotations: { success: false, message: 'quotation timeout' },
			orders: ok,
			consumerOrders: ok,
			reservations: ok,
			invoices: ok,
			arAp: ok,
			evidence: ok,
			auditReferences: ok,
		})

		expect(data.sections.find(section => section.key === 'deal')).toMatchObject({
			items: [],
			error: undefined,
		})
		expect(data.sections.find(section => section.key === 'quotation')).toMatchObject({
			items: [],
			error: 'quotation timeout',
		})
	})
})
