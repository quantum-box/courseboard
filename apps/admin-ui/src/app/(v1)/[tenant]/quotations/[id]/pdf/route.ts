import type { QuotationData } from 'app/(v1)/[tenant]/quotations/action'
import { auth } from 'app/auth'
import { buildDocumentPdf } from 'lib/document-pdf'
import {
	getDocumentPdfSettings,
	resolveDocumentPdfTemplate,
} from 'lib/document-pdf-settings'
import { resolveAuthUrl } from 'lib/auth-url'
import { getRuntimeEnv } from 'lib/runtime-env'
import { joinServerBackendPath } from 'lib/serverBackendUrl'

const DEFAULT_PLATFORM_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

function getAppBaseUrl(): string {
	return resolveAuthUrl()
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

	const res = await fetch(
		joinServerBackendPath(`/v1/erp/quotations/${params.id}`),
		{
			headers: {
				'Content-Type': 'application/json',
				'x-platform-id': platformId,
				'x-operator-id': params.tenant,
				Authorization: `Bearer ${(session as { accessToken?: string }).accessToken ?? ''}`,
			},
		},
	)

	if (res.status === 404) {
		return new Response('Quotation not found', { status: 404 })
	}
	if (res.status === 403) {
		return new Response('Forbidden', { status: 403 })
	}
	if (!res.ok) {
		return new Response('Failed to fetch quotation', { status: 502 })
	}

	const quotation = (await res.json()) as QuotationData
	const settings = await getDocumentPdfSettings(
		params.tenant,
		(session as { accessToken?: string }).accessToken ?? '',
	)
	const url = new URL(request.url)
	const template = resolveDocumentPdfTemplate(
		url.searchParams.get('template'),
		settings.defaultTemplate,
	)
	const sealValues = url.searchParams.getAll('seal')
	const sealValue = sealValues.at(-1)
	const includeSeal =
		sealValue === undefined ? settings.includeSealByDefault : sealValue === '1'

	const pdfBytes = await buildDocumentPdf(
		{
			documentTitle: '見積書',
			documentNumber: quotation.quotationNumber,
			clientName: quotation.clientName,
			clientEmail: quotation.clientEmail,
			dateLabel: '有効期限',
			dateValue: quotation.validUntil,
			currency: quotation.currency,
			subtotalAmount: quotation.subtotalAmount,
			discountAmount: quotation.discountAmount,
			taxAmount: quotation.taxAmount,
			totalAmount: quotation.totalAmount,
			lineItems: quotation.items.map(item => ({
				description: item.description,
				quantity: item.quantity,
				unitPrice: item.unitPrice,
				amount: item.amount,
				discountAmount: item.discountAmount,
			})),
			notes: quotation.notes,
			paymentLinkUrl: quotation.paymentLinkUrl,
		},
		getAppBaseUrl(),
		{
			template,
			logoImage: settings.logoImage,
			sealImage: settings.sealImage,
			includeSeal,
		},
	)

	const fallbackFilename = `quotation-${quotation.quotationNumber}.pdf`
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
