import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildDocumentPdf } from './document-pdf'
import type { InvoicePdfData } from './document-pdf'

const FONT_PATH = resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../public/fonts/ipag.ttf',
)

function mockFetchWithFont() {
	const fontBytes = readFileSync(FONT_PATH)
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (String(url).includes('/fonts/ipag.ttf')) {
				return new Response(fontBytes, { status: 200 })
			}
			return new Response('not found', { status: 404 })
		}),
	)
}

const invoiceData: InvoicePdfData = {
	documentTitle: '請求書',
	documentNumber: 'INV-2026-001',
	clientName: '株式会社テスト',
	clientEmail: 'customer@example.com',
	dateLabel: '支払期限',
	dateValue: '2026-06-30',
	currency: 'JPY',
	subtotalAmount: 10000,
	taxAmount: 1000,
	totalAmount: 11000,
	lineItems: [
		{
			description: 'キャンセル料',
			quantity: 1,
			unitPrice: 10000,
			amount: 10000,
		},
	],
	notes: '備考欄テスト',
}

const quotationData: InvoicePdfData = {
	documentTitle: '見積書',
	documentNumber: 'QUO-2026-001',
	clientName: '山田 太郎',
	clientEmail: 'yamada@example.com',
	dateLabel: '有効期限',
	dateValue: '2026-06-15',
	currency: 'JPY',
	subtotalAmount: 50000,
	discountAmount: 5000,
	taxAmount: 4000,
	totalAmount: 49000,
	lineItems: [
		{
			description: 'ゴルフレッスン（10回）',
			quantity: 10,
			unitPrice: 5000,
			amount: 50000,
			discountAmount: 500,
		},
	],
}

describe('buildDocumentPdf', () => {
	it('generates a valid PDF binary for an invoice', async () => {
		mockFetchWithFont()
		const bytes = await buildDocumentPdf(invoiceData, 'http://localhost:3001')
		expect(bytes).toBeInstanceOf(Uint8Array)
		expect(bytes.length).toBeGreaterThan(1000)
		// PDF starts with %PDF
		const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
		expect(header).toBe('%PDF')
	})

	it('generates a valid PDF binary for a quotation with discount', async () => {
		mockFetchWithFont()
		const bytes = await buildDocumentPdf(quotationData, 'http://localhost:3001')
		expect(bytes).toBeInstanceOf(Uint8Array)
		expect(bytes.length).toBeGreaterThan(1000)
		const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
		expect(header).toBe('%PDF')
	})

	it('handles invoice with no optional fields', async () => {
		mockFetchWithFont()
		const minimal: InvoicePdfData = {
			documentTitle: '請求書',
			documentNumber: 'INV-MIN',
			dateLabel: '支払期限',
			dateValue: '2026-07-01',
			currency: 'JPY',
			subtotalAmount: 5000,
			taxAmount: 500,
			totalAmount: 5500,
			lineItems: [
				{ description: 'Service', quantity: 1, unitPrice: 5000, amount: 5000 },
			],
		}
		const bytes = await buildDocumentPdf(minimal, 'http://localhost:3001')
		expect(bytes).toBeInstanceOf(Uint8Array)
		expect(bytes[0]).toBe(0x25) // '%'
	})

	it('embeds tenant images and alternate template options', async () => {
		mockFetchWithFont()
		const png1x1 =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZgJ5QAAAABJRU5ErkJggg=='
		const bytes = await buildDocumentPdf(invoiceData, 'http://localhost:3001', {
			template: 'japanese',
			logoImage: {
				filename: 'logo.png',
				contentType: 'image/png',
				dataBase64: png1x1,
				updatedAt: '2026-05-28T00:00:00.000Z',
			},
			sealImage: {
				filename: 'seal.png',
				contentType: 'image/png',
				dataBase64: png1x1,
				updatedAt: '2026-05-28T00:00:00.000Z',
			},
			includeSeal: true,
		})
		expect(bytes).toBeInstanceOf(Uint8Array)
		expect(bytes.length).toBeGreaterThan(1000)
		expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe(
			'%PDF',
		)
	})

	it('throws when font URL returns non-ok response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not found', { status: 404 })),
		)
		await expect(
			buildDocumentPdf(invoiceData, 'http://localhost:3001'),
		).rejects.toThrow(/Font load failed/)
	})
})
