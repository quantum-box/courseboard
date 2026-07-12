import type { InvoiceData } from 'app/(v1)/[tenant]/invoices/action'
import { auth } from 'app/auth'
import { resolveAuthUrl } from 'lib/auth-url'
import { buildDocumentPdf } from 'lib/document-pdf'
import {
	getDocumentPdfSettings,
	resolveDocumentPdfTemplate,
} from 'lib/document-pdf-settings'
import { getRuntimeEnv } from 'lib/runtime-env'
import { joinServerBackendPath } from 'lib/serverBackendUrl'

const DEFAULT_PLATFORM_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

function getAppBaseUrl(request: Request): string {
	return resolveAuthUrl(request)
}

export async function GET(
	request: Request,
	{ params }: { params: { tenant: string; id: string } },
) {
	const session = await auth()
	if (!session) {
		return new Response('Unauthorized', { status: 401 })
	}

	const platformId =
		getRuntimeEnv('NEXT_PUBLIC_PLATFORM_ID') ?? DEFAULT_PLATFORM_ID

	const res = await fetch(joinServerBackendPath(`/v1/invoices/${params.id}`), {
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id': platformId,
			'x-operator-id': params.tenant,
			Authorization: `Bearer ${(session as { accessToken?: string }).accessToken ?? ''}`,
		},
	})

	if (res.status === 404) {
		return new Response('Invoice not found', { status: 404 })
	}
	if (res.status === 403) {
		return new Response('Forbidden', { status: 403 })
	}
	if (!res.ok) {
		return new Response('Failed to fetch invoice', { status: 502 })
	}

	const url = new URL(request.url)
	const invoice = (await res.json()) as InvoiceData
	let phase: 'settings' | 'render' = 'settings'
	let pdfBytes: Uint8Array
	try {
		const settings = await getDocumentPdfSettings(
			params.tenant,
			(session as { accessToken?: string }).accessToken ?? '',
		)
		const template = resolveDocumentPdfTemplate(
			url.searchParams.get('template'),
			settings.defaultTemplate,
		)
		const sealValues = url.searchParams.getAll('seal')
		const sealValue = sealValues.at(-1)
		const includeSeal =
			sealValue === undefined
				? settings.includeSealByDefault
				: sealValue === '1'

		phase = 'render'
		pdfBytes = await buildDocumentPdf(
			{
				documentTitle: '請求書',
				documentNumber: invoice.invoiceNumber,
				clientName: invoice.clientName,
				clientEmail: invoice.clientEmail,
				dateLabel: '支払期限',
				dateValue: invoice.dueDate,
				currency: invoice.currency,
				subtotalAmount: invoice.subtotalAmount,
				taxAmount: invoice.taxAmount,
				totalAmount: invoice.totalAmount,
				lineItems: invoice.lineItems.map(item => ({
					description: item.description,
					quantity: item.quantity,
					unitPrice: item.unitPrice,
					amount: item.amount,
				})),
				notes: invoice.notes,
				paymentLinkUrl: invoice.paymentLinkUrl,
			},
			getAppBaseUrl(request),
			{
				template,
				logoImage: settings.logoImage,
				sealImage: settings.sealImage,
				includeSeal,
			},
		)
	} catch (error) {
		console.error(`Invoice PDF ${phase} failed`, error)
		return new Response(
			`PDF ${phase} failed: ${safePdfErrorMessage(error)}`,
			{
				status: 500,
				headers: { 'Cache-Control': 'private, no-store' },
			},
		)
	}

	const fallbackFilename = `invoice-${invoice.invoiceNumber}.pdf`
	const filename = sanitizePdfFilename(
		url.searchParams.get('download') ?? fallbackFilename,
	)
	const disposition =
		url.searchParams.get('preview') === '1' ? 'inline' : 'attachment'
	return new Response(pdfBytes, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `${disposition}; filename="${filename}"`,
			'Cache-Control': 'private, no-store',
		},
	})
}

function sanitizePdfFilename(filename: string) {
	const safe = filename.replace(/[^a-zA-Z0-9-_.]/g, '_')
	return safe.endsWith('.pdf') ? safe : `${safe}.pdf`
}

function safePdfErrorMessage(error: unknown): string {
	if (!(error instanceof Error)) return 'Unknown error'
	return error.message
		.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
		.replace(/([?&](?:token|key|secret|signature|credential)=)[^&\s]+/gi, '$1<redacted>')
		.slice(0, 500)
}
