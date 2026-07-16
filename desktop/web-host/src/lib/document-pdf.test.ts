import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDocumentPdf, type InvoicePdfData } from './document-pdf'

const FONT_PATH = resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../public/fonts/ipag.ttf',
)

const invoiceData: InvoicePdfData = {
	documentTitle: '請求書',
	documentNumber: 'INV-TEST',
	clientName: '株式会社テスト',
	dateLabel: '支払期限',
	dateValue: '2026-07-31',
	currency: 'JPY',
	subtotalAmount: 1000,
	taxAmount: 0,
	totalAmount: 1000,
	lineItems: [
		{
			description: 'キャンセル料',
			quantity: 1,
			unitPrice: 1000,
			amount: 1000,
		},
	],
}

type RuntimeGlobal = typeof globalThis & {
	__workerAssets__?: { fetch(request: Request): Promise<Response> }
}

describe('buildDocumentPdf', () => {
	afterEach(() => {
		delete (globalThis as RuntimeGlobal).__workerAssets__
		vi.unstubAllGlobals()
	})

	it('loads the font through the Worker assets binding without a public self-fetch', async () => {
		const fontBytes = readFileSync(FONT_PATH)
		const assetFetch = vi.fn(
			async () => new Response(fontBytes, { status: 200 }),
		)
		;(globalThis as RuntimeGlobal).__workerAssets__ = { fetch: assetFetch }
		const publicFetch = vi.fn(async () => {
			throw new Error('public self-fetch must not run')
		})
		vi.stubGlobal('fetch', publicFetch)

		const bytes = await buildDocumentPdf(
			invoiceData,
			'https://courseboard.txcloud.app',
		)

		expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe(
			'%PDF',
		)
		expect(assetFetch).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://courseboard.txcloud.app/fonts/ipag.ttf',
			}),
		)
		expect(publicFetch).not.toHaveBeenCalled()
	})
})
