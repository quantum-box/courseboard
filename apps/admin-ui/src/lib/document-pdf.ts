import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFImage, PageSizes, rgb } from 'pdf-lib'
import type {
	DocumentPdfImage,
	DocumentPdfTemplate,
} from './document-pdf-settings'

type LineItem = {
	description: string
	quantity: number
	unitPrice: number
	amount: number
	discountAmount?: number
}

export type InvoicePdfData = {
	documentTitle: string
	documentNumber: string
	clientName?: string | null
	clientEmail?: string | null
	dateLabel: string
	dateValue: string
	currency: string
	subtotalAmount: number
	discountAmount?: number
	taxAmount: number
	totalAmount: number
	lineItems: LineItem[]
	notes?: string | null
	paymentLinkUrl?: string | null
}

export type DocumentPdfOptions = {
	template?: DocumentPdfTemplate
	logoImage?: DocumentPdfImage
	sealImage?: DocumentPdfImage
	includeSeal?: boolean
}

const BLACK = rgb(0, 0, 0)
const GRAY = rgb(0.4, 0.4, 0.4)
const LIGHT_GRAY = rgb(0.9, 0.9, 0.9)
const ACCENT = rgb(0.1, 0.1, 0.5)
const DEEP_RED = rgb(0.45, 0.05, 0.05)
const SOFT_BLUE = rgb(0.93, 0.95, 1)
const WARM_GRAY = rgb(0.95, 0.93, 0.88)

function yen(amount: number): string {
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0,
	}).format(amount)
}

async function loadFont(appBaseUrl: string): Promise<Uint8Array> {
	const fontUrl = `${appBaseUrl.replace(/\/$/, '')}/fonts/ipag.ttf`
	const resp = await fetch(fontUrl)
	if (!resp.ok) throw new Error(`Font load failed: ${resp.status} ${fontUrl}`)
	return new Uint8Array(await resp.arrayBuffer())
}

export async function buildDocumentPdf(
	data: InvoicePdfData,
	appBaseUrl: string,
	options: DocumentPdfOptions = {},
): Promise<Uint8Array> {
	const fontBytes = await loadFont(appBaseUrl)
	const pdfDoc = await PDFDocument.create()
	pdfDoc.registerFontkit(fontkit)
	const font = await pdfDoc.embedFont(fontBytes)
	const logo = await embedPdfImage(pdfDoc, options.logoImage)
	const seal = await embedPdfImage(pdfDoc, options.sealImage)
	const template = options.template ?? 'simple'

	const [pageWidth, pageHeight] = PageSizes.A4
	const page = pdfDoc.addPage([pageWidth, pageHeight])

	const margin = 50
	const colRight = pageWidth - margin
	let y = pageHeight - margin

	const accentColor = template === 'japanese' ? DEEP_RED : ACCENT
	const headerFill = template === 'japanese' ? WARM_GRAY : SOFT_BLUE

	if (template !== 'simple') {
		page.drawRectangle({
			x: margin,
			y: pageHeight - margin - 26,
			width: colRight - margin,
			height: 36,
			color: headerFill,
		})
	}

	if (logo) {
		const logoBox = fitImage(logo.width, logo.height, 110, 42)
		page.drawImage(logo.image, {
			x: margin,
			y: y - logoBox.height + 4,
			width: logoBox.width,
			height: logoBox.height,
		})
		y -= template === 'simple' ? 52 : 46
	}

	page.drawText(data.documentTitle, {
		x:
			template === 'japanese'
				? colRight - font.widthOfTextAtSize(data.documentTitle, 22)
				: margin,
		y,
		size: 22,
		font,
		color: accentColor,
	})

	page.drawText(data.documentNumber, {
		x: margin,
		y: y - 22,
		size: 11,
		font,
		color: GRAY,
	})

	const clientName = data.clientName ?? ''
	const clientEmail = data.clientEmail ?? ''
	if (clientName) {
		page.drawText(clientName, {
			x:
				template === 'detailed'
					? margin
					: colRight - font.widthOfTextAtSize(clientName, 12),
			y: template === 'detailed' ? y - 48 : y,
			size: 12,
			font,
			color: BLACK,
		})
	}
	if (clientEmail) {
		page.drawText(clientEmail, {
			x:
				template === 'detailed'
					? margin
					: colRight - font.widthOfTextAtSize(clientEmail, 9),
			y: template === 'detailed' ? y - 64 : y - 16,
			size: 9,
			font,
			color: GRAY,
		})
	}

	const dateText = `${data.dateLabel}  ${data.dateValue}`
	page.drawText(dateText, {
		x: colRight - font.widthOfTextAtSize(dateText, 10),
		y: y - 32,
		size: 10,
		font,
		color: GRAY,
	})

	y -= template === 'detailed' ? 92 : 60

	page.drawLine({
		start: { x: margin, y },
		end: { x: colRight, y },
		thickness: 1,
		color: LIGHT_GRAY,
	})
	y -= 20

	const colDesc = margin
	const colQty = margin + 260
	const colUnit = margin + 330
	const colDiscount = margin + 400
	const hasDiscount =
		data.discountAmount !== undefined && data.discountAmount > 0
	const colAmt = hasDiscount ? margin + 470 : margin + 430

	const headerY = y
	page.drawRectangle({
		x: margin,
		y: headerY - 4,
		width: colRight - margin,
		height: 20,
		color: template === 'japanese' ? WARM_GRAY : LIGHT_GRAY,
	})

	const headers: [string, number][] = [
		['品目', colDesc],
		['数量', colQty],
		['単価', colUnit],
		...(hasDiscount ? [['値引', colDiscount] as [string, number]] : []),
		['金額', colAmt],
	]
	for (const [label, x] of headers) {
		page.drawText(label, { x, y: headerY, size: 9, font, color: GRAY })
	}

	y -= 24

	for (const item of data.lineItems) {
		const rowY = y

		const maxDescWidth = colQty - colDesc - 8
		let desc = item.description
		while (desc.length > 1 && font.widthOfTextAtSize(desc, 10) > maxDescWidth) {
			desc = desc.slice(0, -1)
		}
		if (desc !== item.description) desc += '…'

		page.drawText(desc, { x: colDesc, y: rowY, size: 10, font, color: BLACK })
		page.drawText(String(item.quantity), {
			x: colQty,
			y: rowY,
			size: 10,
			font,
			color: BLACK,
		})
		page.drawText(yen(item.unitPrice), {
			x: colUnit,
			y: rowY,
			size: 10,
			font,
			color: BLACK,
		})
		if (hasDiscount && item.discountAmount !== undefined) {
			page.drawText(item.discountAmount > 0 ? yen(item.discountAmount) : '-', {
				x: colDiscount,
				y: rowY,
				size: 10,
				font,
				color: BLACK,
			})
		}
		page.drawText(yen(item.amount), {
			x: colAmt,
			y: rowY,
			size: 10,
			font,
			color: BLACK,
		})

		y -= 18

		if (y < margin + 120) {
			const newPage = pdfDoc.addPage([pageWidth, pageHeight])
			newPage.drawText(`${data.documentTitle} (続き)`, {
				x: margin,
				y: pageHeight - margin,
				size: 14,
				font,
				color: accentColor,
			})
			y = pageHeight - margin - 30
		}
	}

	y -= 10
	page.drawLine({
		start: { x: margin, y },
		end: { x: colRight, y },
		thickness: 1,
		color: LIGHT_GRAY,
	})
	y -= 20

	const summaryX = colRight - 200
	const summaryValueX = colRight - 10

	function drawSummaryRow(label: string, value: string, bold = false) {
		const vw = font.widthOfTextAtSize(value, bold ? 12 : 10)
		page.drawText(label, {
			x: summaryX,
			y,
			size: bold ? 12 : 10,
			font,
			color: bold ? BLACK : GRAY,
		})
		page.drawText(value, {
			x: summaryValueX - vw,
			y,
			size: bold ? 12 : 10,
			font,
			color: bold ? BLACK : GRAY,
		})
		y -= bold ? 22 : 18
	}

	drawSummaryRow('小計', yen(data.subtotalAmount))
	if (hasDiscount && data.discountAmount) {
		drawSummaryRow('値引', `-${yen(data.discountAmount)}`)
	}
	drawSummaryRow('税', yen(data.taxAmount))
	drawSummaryRow('合計', yen(data.totalAmount), true)

	if (seal && options.includeSeal !== false) {
		const sealBox = fitImage(seal.width, seal.height, 74, 74)
		page.drawImage(seal.image, {
			x: colRight - 120,
			y: y + 18,
			width: sealBox.width,
			height: sealBox.height,
			opacity: 0.82,
		})
	}

	if (data.notes) {
		y -= 20
		page.drawText('備考', { x: margin, y, size: 10, font, color: GRAY })
		y -= 16
		const noteLines = data.notes.split('\n').slice(0, 10)
		for (const line of noteLines) {
			page.drawText(line.slice(0, 80), {
				x: margin,
				y,
				size: 9,
				font,
				color: GRAY,
			})
			y -= 14
		}
	}

	if (data.paymentLinkUrl) {
		y -= 10
		page.drawText('お支払いリンク', {
			x: margin,
			y,
			size: 10,
			font,
			color: GRAY,
		})
		y -= 14
		page.drawText(data.paymentLinkUrl.slice(0, 80), {
			x: margin,
			y,
			size: 9,
			font,
			color: ACCENT,
		})
	}

	return pdfDoc.save()
}

async function embedPdfImage(
	pdfDoc: PDFDocument,
	image?: DocumentPdfImage,
): Promise<
	| {
			image: PDFImage
			width: number
			height: number
	  }
	| undefined
> {
	if (!image || image.contentType === 'image/svg+xml') return undefined
	const bytes = decodeBase64(image.dataBase64)
	const embedded =
		image.contentType === 'image/png'
			? await pdfDoc.embedPng(bytes)
			: await pdfDoc.embedJpg(bytes)
	return {
		image: embedded,
		width: embedded.width,
		height: embedded.height,
	}
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

function fitImage(
	width: number,
	height: number,
	maxWidth: number,
	maxHeight: number,
) {
	const scale = Math.min(maxWidth / width, maxHeight / height)
	return {
		width: width * scale,
		height: height * scale,
	}
}
