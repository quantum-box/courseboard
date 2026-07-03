import { describe, expect, it } from 'vitest'
import {
	mapOcrToSalesLedgerForm,
	normalizePaymentMethod,
	ocrDateTimeToLocal,
} from './map-ocr-to-sales-ledger-form'

describe('normalizePaymentMethod', () => {
	it('maps Japanese and English payment labels', () => {
		expect(normalizePaymentMethod('現金')).toBe('cash')
		expect(normalizePaymentMethod('credit card')).toBe('credit_card')
		expect(normalizePaymentMethod('クレジットカード')).toBe('credit_card')
		expect(normalizePaymentMethod('PayPay')).toBe('qr_code')
	})
})

describe('ocrDateTimeToLocal', () => {
	it('converts common OCR date and datetime values', () => {
		expect(ocrDateTimeToLocal('2026-03-30T20:44:00')).toBe('2026-03-30T20:44')
		expect(ocrDateTimeToLocal('2026-05-08')).toBe('2026-05-08T12:00')
		expect(ocrDateTimeToLocal('2026/5/8 9:07')).toBe('2026-05-08T09:07')
		expect(ocrDateTimeToLocal('２０２６年５月８日')).toBe('2026-05-08T12:00')
	})
})

describe('mapOcrToSalesLedgerForm', () => {
	it('maps single-item receipts', () => {
		const mapped = mapOcrToSalesLedgerForm(
			{
				register_closed_at: '2026-03-30T20:44:00',
				total: 1280,
				store_name: 'Test Store',
				payment_method: 'cash',
				items: [{ name: 'Coffee', quantity: 2, unit_price: 640, amount: 1280 }],
			},
			'2026-01-01T09:00',
		)

		expect(mapped.registerClosedAt).toBe('2026-03-30T20:44')
		expect(mapped.productName).toBe('Coffee')
		expect(mapped.quantity).toBe('2')
		expect(mapped.unitPrice).toBe('640')
		expect(mapped.totalAmount).toBe('1280')
		expect(mapped.notes).toBe('取引先: Test Store')
	})

	it('maps multi-item receipts to aggregate line', () => {
		const mapped = mapOcrToSalesLedgerForm(
			{
				date: '2026-05-08',
				total: '￥3,000',
				items: [
					{ name: 'A', amount: 1000 },
					{ name: 'B', amount: 2000 },
				],
			},
			'2026-01-01T09:00',
		)

		expect(mapped.productName).toBe('レシート売上（2品目）')
		expect(mapped.unitPrice).toBe('3000')
		expect(mapped.totalAmount).toBe('3000')
	})

	it('falls back to current register close time when OCR has no date', () => {
		const mapped = mapOcrToSalesLedgerForm(
			{
				totalAmount: '900',
			},
			'2026-01-01T09:00',
		)

		expect(mapped.registerClosedAt).toBe('2026-01-01T09:00')
		expect(mapped.productName).toBe('レシート売上')
		expect(mapped.totalAmount).toBe('900')
	})
})
