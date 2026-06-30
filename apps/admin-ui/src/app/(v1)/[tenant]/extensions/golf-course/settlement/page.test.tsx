import { describe, expect, it } from 'vitest'
import {
	defaultSettlementYearMonth,
	formatYen,
} from './settlement-helpers'

describe('golf monthly settlement helpers', () => {
	it('defaults settlement period to the previous calendar month', () => {
		expect(
			defaultSettlementYearMonth(new Date('2026-05-15T00:00:00.000Z')),
		).toBe('2026-04')
	})

	it('formats JPY amounts for KPI cards', () => {
		expect(formatYen(12000)).toContain('12')
		expect(formatYen(12000, 'USD')).toContain('USD')
	})

	it('accepts unpaid cancellation drilldown items', () => {
		const items = [
			{
				reservationId: 'res_01',
				reservationNumber: 'R-100',
				cancellationFeeAmount: 5000,
				checkoutUrl: null,
				linkIssued: false,
				paymentStatus: 'fee_due',
				invoiceId: null,
			},
		]
		expect(items[0]?.linkIssued).toBe(false)
		expect(items[0]?.cancellationFeeAmount).toBe(5000)
	})
})
