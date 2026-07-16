import { resolveAuthUrl } from 'lib/auth-url'
import {
	loadCourseboardTenants,
	resolveFieldCourseboardPrincipal,
} from 'lib/courseboard-auth-context'
import { buildDocumentPdf } from 'lib/document-pdf'
import {
	getDocumentPdfSettings,
	isDocumentPdfTemplate,
	resolveDocumentPdfTemplate,
} from 'lib/document-pdf-settings'
import { PLATFORM_IDS } from 'lib/mode'
import type { InvoiceData } from 'lib/invoice'
import {
	applyNativeCors,
	isRejectedCrossOrigin,
	nativeCorsPreflight,
} from 'lib/native-cors'
import { joinServerBackendPath } from 'lib/serverBackendUrl'

const ALLOWED_METHODS = ['GET'] as const
const INVOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const TENANT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const DOWNLOAD_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ALLOWED_QUERY_KEYS = new Set([
	'template',
	'seal',
	'download',
	'preview',
])
const UPSTREAM_TIMEOUT_MS = 30_000

type RouteContext = {
	params: { id: string }
}

type PdfQuery = {
	template?: string
	includeSeal?: boolean
	filename?: string
	preview: boolean
}

function json(request: Request, body: unknown, init: ResponseInit = {}) {
	const headers = new Headers(init.headers)
	headers.set('cache-control', 'private, no-store')
	return applyNativeCors(
		request,
		Response.json(body, { ...init, headers }),
	)
}

function errorResponse(
	request: Request,
	status: number,
	code: string,
	message: string,
	init: ResponseInit = {},
) {
	return json(request, { code, message }, { ...init, status })
}

function parseSingleQueryValue(
	searchParams: URLSearchParams,
	key: string,
) {
	const values = searchParams.getAll(key)
	return values.length <= 1
		? { ok: true as const, value: values[0] }
		: { ok: false as const }
}

function parsePdfQuery(url: URL):
	| { ok: true; value: PdfQuery }
	| { ok: false } {
	let hasUnexpectedQueryKey = false
	url.searchParams.forEach((_value, key) => {
		if (!ALLOWED_QUERY_KEYS.has(key)) hasUnexpectedQueryKey = true
	})
	if (hasUnexpectedQueryKey) return { ok: false }

	const template = parseSingleQueryValue(url.searchParams, 'template')
	const seal = parseSingleQueryValue(url.searchParams, 'seal')
	const download = parseSingleQueryValue(url.searchParams, 'download')
	const preview = parseSingleQueryValue(url.searchParams, 'preview')
	if (!template.ok || !seal.ok || !download.ok || !preview.ok) {
		return { ok: false }
	}
	if (template.value !== undefined && !isDocumentPdfTemplate(template.value)) {
		return { ok: false }
	}
	if (seal.value !== undefined && seal.value !== '0' && seal.value !== '1') {
		return { ok: false }
	}
	if (
		download.value !== undefined &&
		!DOWNLOAD_FILENAME_PATTERN.test(download.value)
	) {
		return { ok: false }
	}
	if (
		preview.value !== undefined &&
		preview.value !== '0' &&
		preview.value !== '1'
	) {
		return { ok: false }
	}

	return {
		ok: true,
		value: {
			template: template.value,
			includeSeal:
				seal.value === undefined ? undefined : seal.value === '1',
			filename: download.value,
			preview: preview.value === '1',
		},
	}
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalString(value: unknown, maxLength: number) {
	return (
		value === undefined ||
		value === null ||
		(typeof value === 'string' && value.length <= maxLength)
	)
}

function isInvoiceData(value: unknown): value is InvoiceData {
	if (!value || typeof value !== 'object') return false
	const invoice = value as Record<string, unknown>
	if (
		typeof invoice.tenantId !== 'string' ||
		typeof invoice.invoiceNumber !== 'string' ||
		invoice.invoiceNumber.length === 0 ||
		invoice.invoiceNumber.length > 256 ||
		typeof invoice.dueDate !== 'string' ||
		invoice.dueDate.length > 128 ||
		typeof invoice.currency !== 'string' ||
		invoice.currency.length > 16 ||
		!isFiniteNumber(invoice.subtotalAmount) ||
		!isFiniteNumber(invoice.taxAmount) ||
		!isFiniteNumber(invoice.totalAmount) ||
		!isOptionalString(invoice.clientName, 1_000) ||
		!isOptionalString(invoice.clientEmail, 1_000) ||
		!isOptionalString(invoice.notes, 10_000) ||
		!isOptionalString(invoice.paymentLinkUrl, 2_048) ||
		!Array.isArray(invoice.lineItems) ||
		invoice.lineItems.length > 500
	) {
		return false
	}

	return invoice.lineItems.every(item => {
		if (!item || typeof item !== 'object') return false
		const lineItem = item as Record<string, unknown>
		return (
			typeof lineItem.description === 'string' &&
			lineItem.description.length <= 2_000 &&
			isFiniteNumber(lineItem.quantity) &&
			isFiniteNumber(lineItem.unitPrice) &&
			isFiniteNumber(lineItem.amount)
		)
	})
}

function sanitizePdfFilename(filename: string) {
	const safe = filename.replace(/[^a-zA-Z0-9-_.]/g, '_').slice(0, 128)
	return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`
}

export async function OPTIONS(request: Request) {
	return nativeCorsPreflight(request, ALLOWED_METHODS)
}

export async function GET(request: Request, { params }: RouteContext) {
	if (isRejectedCrossOrigin(request)) {
		return errorResponse(
			request,
			403,
			'FORBIDDEN_ORIGIN',
			'Origin is not allowed',
		)
	}
	if (!INVOICE_ID_PATTERN.test(params.id)) {
		return errorResponse(
			request,
			400,
			'INVALID_INVOICE_ID',
			'Invoice ID is invalid',
		)
	}

	const query = parsePdfQuery(new URL(request.url))
	if (!query.ok) {
		return errorResponse(
			request,
			400,
			'INVALID_PDF_OPTIONS',
			'PDF options are invalid',
		)
	}

	const operatorId = request.headers.get('x-operator-id')
	if (!operatorId || !TENANT_ID_PATTERN.test(operatorId)) {
		return errorResponse(
			request,
			400,
			'INVALID_OPERATOR',
			'A valid x-operator-id header is required',
		)
	}

	const principal = await resolveFieldCourseboardPrincipal(request)
	if (!principal) {
		return errorResponse(
			request,
			401,
			'UNAUTHORIZED',
			'Authentication is required',
		)
	}
	const tenantResult = await loadCourseboardTenants(principal)
	if (tenantResult.kind === 'unauthorized') {
		return errorResponse(
			request,
			401,
			'UNAUTHORIZED',
			'Authentication has expired',
		)
	}
	if (tenantResult.kind === 'unavailable') {
		return errorResponse(
			request,
			503,
			'TENANT_DIRECTORY_UNAVAILABLE',
			'Tenant authorization is temporarily unavailable',
		)
	}

	const authorizedTenant = tenantResult.tenants.find(
		tenant => tenant.id === operatorId,
	)
	if (!authorizedTenant) {
		return tenantResult.partial
			? errorResponse(
					request,
					503,
					'TENANT_DIRECTORY_PARTIAL',
					'Tenant authorization could not be confirmed',
				)
			: errorResponse(
					request,
					403,
					'FORBIDDEN',
					'Tenant access is forbidden',
					{
						headers: {
							'x-courseboard-auth-denial': 'tenant',
						},
					},
				)
	}

	const accessToken = tenantResult.session.accessToken
	const platformId = PLATFORM_IDS[authorizedTenant.mode]
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
	let upstream: Response
	try {
		upstream = await fetch(
			joinServerBackendPath(`/v1/invoices/${params.id}`),
			{
				headers: {
					accept: 'application/json',
					authorization: `Bearer ${accessToken}`,
					'x-operator-id': authorizedTenant.id,
					'x-platform-id': platformId,
				},
				cache: 'no-store',
				redirect: 'manual',
				signal: controller.signal,
			},
		)
	} catch {
		return errorResponse(
			request,
			502,
			'INVOICE_API_UNAVAILABLE',
			'Invoice service is unavailable',
		)
	} finally {
		clearTimeout(timeout)
	}

	if (upstream.status === 404) {
		return errorResponse(
			request,
			404,
			'INVOICE_NOT_FOUND',
			'Invoice was not found',
		)
	}
	if (upstream.status === 401) {
		return errorResponse(
			request,
			401,
			'UNAUTHORIZED',
			'Authentication has expired',
		)
	}
	if (upstream.status === 403) {
		return errorResponse(
			request,
			403,
			'FORBIDDEN',
			'Tenant access is forbidden',
		)
	}
	if (!upstream.ok) {
		return errorResponse(
			request,
			502,
			'INVOICE_API_FAILED',
			'Invoice service returned an error',
		)
	}

	let invoiceValue: unknown
	try {
		invoiceValue = await upstream.json()
	} catch {
		return errorResponse(
			request,
			502,
			'INVALID_INVOICE_RESPONSE',
			'Invoice service returned an invalid response',
		)
	}
	if (
		!isInvoiceData(invoiceValue) ||
		invoiceValue.tenantId !== authorizedTenant.id
	) {
		return errorResponse(
			request,
			502,
			'INVALID_INVOICE_RESPONSE',
			'Invoice service returned an invalid response',
		)
	}
	const invoice = invoiceValue

	let pdfBytes: Uint8Array
	try {
		const settings = await getDocumentPdfSettings(
			authorizedTenant.id,
			accessToken,
			platformId,
		)
		const template = resolveDocumentPdfTemplate(
			query.value.template,
			settings.defaultTemplate,
		)
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
			resolveAuthUrl(request),
			{
				template,
				logoImage: settings.logoImage,
				sealImage: settings.sealImage,
				includeSeal:
					query.value.includeSeal ?? settings.includeSealByDefault,
			},
		)
	} catch (error) {
		console.error(
			'Course Board invoice PDF generation failed',
			error instanceof Error ? error.name : 'UnknownError',
		)
		return errorResponse(
			request,
			500,
			'PDF_GENERATION_FAILED',
			'Invoice PDF could not be generated',
		)
	}

	const fallbackFilename = `invoice-${invoice.invoiceNumber}.pdf`
	const filename = sanitizePdfFilename(
		query.value.filename ?? fallbackFilename,
	)
	const headers = new Headers({
		'cache-control': 'private, no-store',
		'content-disposition': `${query.value.preview ? 'inline' : 'attachment'}; filename="${filename}"`,
		'content-type': 'application/pdf',
		'x-content-type-options': 'nosniff',
	})
	return applyNativeCors(
		request,
		new Response(pdfBytes, { status: 200, headers }),
	)
}
