/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../i18n'
import { NewCancellationFeePage } from './CancellationFeesPage'

const api = vi.hoisted(() => ({ field: vi.fn() }))
const router = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, fieldApiJson: api.field }
})

vi.mock('../../lib/router', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/router')>()
  return { ...actual, navigate: router.navigate }
})

afterEach(() => {
  cleanup()
  api.field.mockReset()
  router.navigate.mockReset()
  vi.unstubAllGlobals()
})

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-1',
    clientId: '',
    clientName: '山田 太郎',
    lineItems: [],
    dueDate: '2099-09-11',
    status: 'Sent',
    currency: 'JPY',
    subtotalAmount: 5000,
    taxAmount: 0,
    totalAmount: 5000,
    paymentLinkUrl: 'https://example.com/pay/inv_1',
    paymentLinkStatus: 'Ready',
    emailDeliveryStatus: null,
    smsDeliveryStatus: 'Sent',
    createdAt: '2026-09-04T00:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <NewCancellationFeePage />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

function checkbox(name: RegExp) {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement
}

function fillSnapshot(name = '山田 太郎', phone = '090-0000-0000') {
  // Email is enabled by default; turn it off so this test exercises the
  // snapshot-only SMS path without requiring a second destination.
  fireEvent.click(checkbox(/請求書と支払いリンク/))
  fireEvent.click(checkbox(/短い支払いの案内/))
  fireEvent.change(screen.getByLabelText('請求先の名前', { exact: false }), {
    target: { value: name },
  })
  fireEvent.change(screen.getByLabelText('送り先の電話番号', { exact: false }), {
    target: { value: phone },
  })
  fireEvent.click(checkbox(/取引のSMSを受け取ることに同意/))
}

function bodyOf(call: unknown[]) {
  const init = call[1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, any>
}

describe('the dedicated cancellation fee form', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' })
  })

  it('creates an unregistered snapshot through the dedicated route', async () => {
    api.field.mockResolvedValue(invoice())
    renderPage()
    fillSnapshot()

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))

    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))
    const create = api.field.mock.calls.find(call => call[0] === '/v1/cancellation-fees')!
    const body = bodyOf(create)
    expect(body.billTo).toEqual({
      name: '山田 太郎',
      phone: '+819000000000',
    })
    expect(body.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(body.lineItems).toHaveLength(1)
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('clientId')
    expect(body).not.toHaveProperty('sources')
    expect(body).not.toHaveProperty('smsMessage')
    expect(api.field.mock.calls.some(call => String(call[0]).startsWith('/v1/invoices'))).toBe(false)
  })

  it('does not offer customer registration, arbitrary ids, or free SMS text', () => {
    renderPage()

    expect(screen.queryByLabelText(/顧客ID/)).toBeNull()
    expect(screen.queryByText(/顧客台帳にも登録/)).toBeNull()
    expect(screen.queryByLabelText(/SMSの文面/)).toBeNull()
    expect(screen.queryByLabelText(/請求先の種類/)).toBeNull()
  })

  it('resends delivery through /send with a stable explicit idempotency key', async () => {
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees') return invoice({ smsDeliveryStatus: 'Pending' })
      if (path.endsWith('/fulfill')) {
        return invoice({ status: 'SendFailed', smsDeliveryStatus: 'Failed', smsDeliveryFailureCode: 'BillingNotReady' })
      }
      if (path.endsWith('/send')) return invoice()
      return invoice()
    })
    renderPage()
    fillSnapshot()

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')

    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(
      api.field.mock.calls.some(call => String(call[0]).endsWith('/send')),
    ).toBe(true))
    const sends = api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))
    expect(bodyOf(sends[0]!)).toMatchObject({
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      sendEmail: false,
      sendSms: true,
    })
    expect(api.field.mock.calls.some(call => String(call[0]).startsWith('/v1/invoices'))).toBe(false)
  })
})
