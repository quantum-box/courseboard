import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildInvoicePdf } from './invoice-pdf'

describe('buildInvoicePdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('generates a Japanese invoice PDF in the React client', async () => {
    const fontPath = fileURLToPath(
      new URL('../assets/ipag.ttf', import.meta.url),
    )
    const font = await readFile(fontPath)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(font)))

    const bytes = await buildInvoicePdf({
      invoiceNumber: 'INV-TEST',
      clientName: '株式会社テスト',
      dueDate: '2026-07-31',
      currency: 'JPY',
      subtotalAmount: 1000,
      taxAmount: 100,
      totalAmount: 1100,
      lineItems: [{
        description: 'キャンセル料',
        quantity: 1,
        unitPrice: 1000,
        amount: 1000,
      }],
    })

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF')
  })
})
