import { i18next } from '../i18n'

import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PageSizes, rgb } from 'pdf-lib'

export type InvoicePdfLineItem = {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export type InvoicePdfData = {
  invoiceNumber: string
  clientName?: string | null
  clientEmail?: string | null
  dueDate: string
  currency: string
  subtotalAmount: number
  taxAmount: number
  totalAmount: number
  lineItems: InvoicePdfLineItem[]
  notes?: string | null
  paymentLinkUrl?: string | null
}

const fontUrl = new URL('../assets/ipag.ttf', import.meta.url)

function money(amount: number, currency: string) {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(amount)
}

function fitText(
  value: string,
  maxWidth: number,
  width: (text: string) => number,
) {
  let text = value
  while (text.length > 1 && width(text) > maxWidth) {
    text = text.slice(0, -1)
  }
  return text === value ? text : `${text}…`
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const fontResponse = await fetch(fontUrl)
  if (!fontResponse.ok) {
    throw new Error(i18next.t('payment:pdf.fontFailed'))
  }

  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const font = await document.embedFont(await fontResponse.arrayBuffer(), {
    subset: true,
  })
  const [pageWidth, pageHeight] = PageSizes.A4
  const margin = 48
  const black = rgb(0.08, 0.1, 0.14)
  const muted = rgb(0.38, 0.43, 0.5)
  const line = rgb(0.86, 0.88, 0.91)
  const header = rgb(0.93, 0.96, 1)

  let page = document.addPage(PageSizes.A4)
  let y = pageHeight - margin

  const drawHeader = (continued = false) => {
    page.drawText(continued ? i18next.t('payment:pdf.titleContinued') : i18next.t('payment:pdf.title'), {
      x: margin,
      y,
      size: continued ? 15 : 24,
      font,
      color: black,
    })
    if (!continued) {
      page.drawText(data.invoiceNumber, {
        x: margin,
        y: y - 24,
        size: 10,
        font,
        color: muted,
      })
      const client = data.clientName ?? data.clientEmail ?? ''
      if (client) {
        page.drawText(fitText(client, 230, text => font.widthOfTextAtSize(text, 11)), {
          x: pageWidth - margin - Math.min(font.widthOfTextAtSize(client, 11), 230),
          y,
          size: 11,
          font,
          color: black,
        })
      }
      const due = i18next.t('payment:pdf.due', { date: data.dueDate })
      page.drawText(due, {
        x: pageWidth - margin - font.widthOfTextAtSize(due, 9),
        y: y - 24,
        size: 9,
        font,
        color: muted,
      })
      y -= 62
    } else {
      y -= 30
    }
  }

  const drawTableHeader = () => {
    page.drawRectangle({
      x: margin,
      y: y - 4,
      width: pageWidth - margin * 2,
      height: 20,
      color: header,
    })
    for (const [label, x] of [
      [i18next.t('payment:pdf.columns.item'), margin],
      [i18next.t('payment:pdf.columns.quantity'), 310],
      [i18next.t('payment:pdf.columns.unitPrice'), 372],
      [i18next.t('payment:pdf.columns.amount'), 475],
    ] as const) {
      page.drawText(label, { x, y, size: 9, font, color: muted })
    }
    y -= 24
  }

  drawHeader()
  drawTableHeader()

  for (const item of data.lineItems) {
    if (y < 180) {
      page = document.addPage(PageSizes.A4)
      y = pageHeight - margin
      drawHeader(true)
      drawTableHeader()
    }
    page.drawText(
      fitText(item.description, 245, text => font.widthOfTextAtSize(text, 9)),
      { x: margin, y, size: 9, font, color: black },
    )
    page.drawText(String(item.quantity), { x: 310, y, size: 9, font, color: black })
    page.drawText(money(item.unitPrice, data.currency), {
      x: 372,
      y,
      size: 9,
      font,
      color: black,
    })
    page.drawText(money(item.amount, data.currency), {
      x: 475,
      y,
      size: 9,
      font,
      color: black,
    })
    y -= 18
  }

  page.drawLine({
    start: { x: margin, y: y - 2 },
    end: { x: pageWidth - margin, y: y - 2 },
    thickness: 1,
    color: line,
  })
  y -= 26

  const drawTotal = (label: string, amount: number, emphasized = false) => {
    page.drawText(label, {
      x: 360,
      y,
      size: emphasized ? 12 : 10,
      font,
      color: emphasized ? black : muted,
    })
    const value = money(amount, data.currency)
    page.drawText(value, {
      x: pageWidth - margin - font.widthOfTextAtSize(value, emphasized ? 12 : 10),
      y,
      size: emphasized ? 12 : 10,
      font,
      color: emphasized ? black : muted,
    })
    y -= emphasized ? 24 : 18
  }

  drawTotal(i18next.t('payment:pdf.subtotal'), data.subtotalAmount)
  drawTotal(i18next.t('payment:pdf.tax'), data.taxAmount)
  drawTotal(i18next.t('payment:pdf.total'), data.totalAmount, true)

  if (data.notes) {
    y -= 8
    page.drawText(i18next.t('payment:pdf.notes'), { x: margin, y, size: 9, font, color: muted })
    y -= 15
    for (const note of data.notes.split('\n').slice(0, 8)) {
      page.drawText(
        fitText(note, pageWidth - margin * 2, text => font.widthOfTextAtSize(text, 8)),
        { x: margin, y, size: 8, font, color: muted },
      )
      y -= 13
    }
  }

  if (data.paymentLinkUrl && y > 50) {
    y -= 8
    page.drawText(i18next.t('payment:pdf.paymentLink'), { x: margin, y, size: 9, font, color: muted })
    y -= 14
    page.drawText(
      fitText(
        data.paymentLinkUrl,
        pageWidth - margin * 2,
        text => font.widthOfTextAtSize(text, 8),
      ),
      { x: margin, y, size: 8, font, color: rgb(0.12, 0.29, 0.65) },
    )
  }

  return document.save()
}
