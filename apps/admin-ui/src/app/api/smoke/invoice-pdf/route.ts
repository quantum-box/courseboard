import { buildDocumentPdf } from 'lib/document-pdf'

export async function GET(request: Request) {
	const startedAt = Date.now()
	try {
		const bytes = await buildDocumentPdf(
			{
				documentTitle: '請求書',
				documentNumber: 'SMOKE-TEST',
				clientName: 'テスト',
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
			},
			new URL(request.url).origin,
		)
		return new Response(bytes, {
			headers: {
				'Content-Type': 'application/pdf',
				'X-PDF-Duration-Ms': String(Date.now() - startedAt),
			},
		})
	} catch (error) {
		return Response.json(
			{
				ok: false,
				durationMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
			},
			{ status: 500 },
		)
	}
}
