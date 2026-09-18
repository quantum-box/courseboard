/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../i18n'
import { NewCancellationFeePage } from './CancellationFeesPage'

const api = vi.hoisted(() => ({ field: vi.fn(), courseboard: vi.fn() }))
const router = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, fieldApiJson: api.field, courseboardApiJson: api.courseboard }
})

vi.mock('../../lib/router', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/router')>()
  return { ...actual, navigate: router.navigate }
})

afterEach(() => {
  cleanup()
  api.field.mockReset()
  api.courseboard.mockReset()
  router.navigate.mockReset()
})

beforeEach(() => {
  // The name box searches the ledger as the desk types, so every test needs an
  // answer for it. A test about the candidates replaces this with its own.
  api.courseboard.mockResolvedValue({ items: [] })
})

/** A created invoice that reached the recipient, so the happy path completes. */
function sentInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-1',
    clientId: '',
    lineItems: [],
    dueDate: '2026-09-11',
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

/**
 * Fill in the three things the desk actually has when somebody cancels by
 * phone: a name, a mobile number, and an amount.
 *
 * No recipient type is chosen and no identifier is typed, because that is the
 * point: the form opens on the person the desk is about to bill.
 */
function fillNamePhoneAmount(name = '山田 太郎', phone = '090-0000-0000') {
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
  return JSON.parse(String(init.body)) as Record<string, never>
}

describe('the cancellation fee form', () => {
  it('invoices somebody who is not in the ledger from a name, a number and an amount', async () => {
    // No customer ID exists for a caller the club has never taken money from.
    // Before this the desk had to invent one, and the ledger filled with rows
    // nothing else referred to.
    api.field.mockResolvedValue(sentInvoice())
    renderPage()
    fillNamePhoneAmount()

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    // The four things that cannot be walked back once the link is out.
    expect(screen.getByText('山田 太郎')).toBeTruthy()
    expect(screen.getByText('+819000000000')).toBeTruthy()
    expect(screen.getByText('登録しません')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(api.field).toHaveBeenCalled())

    const create = api.field.mock.calls.find(call => call[0] === '/v1/invoices')!
    const body = bodyOf(create)
    expect(body.billTo).toEqual({
      kind: 'unregistered',
      name: '山田 太郎',
      phone: '+819000000000',
    })
    expect(body).not.toHaveProperty('customerId')
    // Nothing was written to the ledger for a recipient nobody asked to keep.
    expect(api.field.mock.calls.some(call => call[0] === '/v1/erp/customers')).toBe(false)
  })

  it('creates the ledger entry before the invoice when the desk asks to keep the recipient', async () => {
    api.courseboard.mockResolvedValue({ items: [] })
    api.field.mockImplementation(async (path: string) => (
      path === '/v1/erp/customers' ? { id: 'cus_created' } : sentInvoice()
    ))
    renderPage()
    fillNamePhoneAmount()
    fireEvent.click(checkbox(/送信先を顧客台帳にも登録する/))

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この名前で登録します')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(router.navigate).toHaveBeenCalled())

    const register = bodyOf(api.field.mock.calls.find(call => call[0] === '/v1/erp/customers')!)
    expect(register.name).toBe('山田 太郎')
    expect(register.idempotencyKey).toBeTruthy()
    // The invoice then goes to the customer that was just created, so the
    // ledger row and the invoice are the same person rather than two records.
    const create = bodyOf(api.field.mock.calls.find(call => call[0] === '/v1/invoices')!)
    expect(create.billTo).toEqual({ kind: 'customer', customerId: 'cus_created' })
  })

  it('reuses the customer it already created when the invoice failed and is retried', async () => {
    api.courseboard.mockResolvedValue({ items: [] })
    let invoiceAttempts = 0
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/erp/customers') return { id: 'cus_created' }
      if (path === '/v1/invoices') {
        invoiceAttempts += 1
        if (invoiceAttempts === 1) throw new Error('upstream is down')
        return sentInvoice()
      }
      return sentInvoice()
    })
    renderPage()
    fillNamePhoneAmount()
    fireEvent.click(checkbox(/送信先を顧客台帳にも登録する/))

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この名前で登録します')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('upstream is down')

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この名前で登録します')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(router.navigate).toHaveBeenCalled())

    // One ledger row, not one per attempt.
    const registrations = api.field.mock.calls.filter(call => call[0] === '/v1/erp/customers')
    expect(registrations).toHaveLength(1)
    // And the retry carries the key of the attempt that may already have
    // landed, so Field answers with the invoice it created rather than a second.
    const keys = api.field.mock.calls
      .filter(call => call[0] === '/v1/invoices')
      .map(call => bodyOf(call).idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it('retries only the sending when the invoice was created but the SMS was not delivered', async () => {
    // Creating the invoice again would leave the club chasing two payments for
    // one cancellation.
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/invoices') return sentInvoice({ smsDeliveryStatus: 'Pending' })
      if (path.endsWith('/fulfill')) {
        return sentInvoice({ smsDeliveryStatus: 'Failed', smsDeliveryFailureCode: 'BillingNotReady' })
      }
      return sentInvoice()
    })
    renderPage()
    fillNamePhoneAmount()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')

    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(
      api.field.mock.calls.some(call => String(call[0]).endsWith('/payment-link/resend')),
    ).toBe(true))
    expect(api.field.mock.calls.filter(call => call[0] === '/v1/invoices')).toHaveLength(1)
  })

  it('offers ledger entries for the name as it is typed, and never picks one on its own', async () => {
    // A shared mobile number and two members called 本田 are both ordinary.
    // Merging on a match would attach one person's history to another.
    api.courseboard.mockResolvedValue({
      items: [{ id: 'cus_existing', name: '山田 太郎', phone: '+819011111111' }],
    })
    api.field.mockResolvedValue(sentInvoice())
    renderPage()
    // Typing the name is the whole search: no recipient type to choose first,
    // and nothing to tick before the ledger is consulted.
    fillNamePhoneAmount()

    const candidate = await screen.findByRole('button', { name: /山田 太郎/ })
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('登録しません')
    fireEvent.click(screen.getByRole('button', { name: '戻って直す' }))

    fireEvent.click(candidate)
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('登録ずみの相手です')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(router.navigate).toHaveBeenCalled())

    expect(api.field.mock.calls.some(call => call[0] === '/v1/erp/customers')).toBe(false)
    const create = bodyOf(api.field.mock.calls.find(call => call[0] === '/v1/invoices')!)
    expect(create.billTo).toEqual({ kind: 'customer', customerId: 'cus_existing' })
  })

  it('never asks for an identifier: the ledger is a choice, not a requirement', async () => {
    // What the desk sees is one name box. The recipient the club has never
    // billed before is the ordinary case, and it has no id to offer.
    api.courseboard.mockResolvedValue({ items: [] })
    api.field.mockResolvedValue(sentInvoice())
    renderPage()

    expect(screen.queryByLabelText(/顧客ID/)).toBeNull()
    const kind = screen.getByLabelText('請求先の種類', { exact: false }) as HTMLSelectElement
    expect([...kind.options].map(option => option.value)).toEqual(['person', 'client'])

    fillNamePhoneAmount('新谷 花子', '080-1111-2222')
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(api.field).toHaveBeenCalled())

    const create = bodyOf(api.field.mock.calls.find(call => call[0] === '/v1/invoices')!)
    expect(create.billTo).toEqual({
      kind: 'unregistered',
      name: '新谷 花子',
      phone: '+818011112222',
    })
  })

  it('shows the finished SMS, and what it will be billed as, before it goes', async () => {
    // Field substitutes the placeholders after this screen hands the send
    // over, so without this the desk confirms a template and finds out what
    // the guest actually received afterwards.
    api.field.mockResolvedValue(sentInvoice())
    renderPage()
    fillNamePhoneAmount()

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')

    const preview = screen.getByText(/キャンセル料5000円/)
    expect(preview.textContent).toContain('https://tachyonfield.txcloud.app/p/')
    expect(preview.textContent).not.toContain('{amount}')
    expect(preview.textContent).not.toContain('{url}')
    // What this send costs, while it can still be shortened. Two of them: the
    // form behind the dialog carries the same count under the textarea.
    expect(screen.getAllByText(/118文字・2通ぶん/)).toHaveLength(2)
  })

  it('counts the message as it is typed, not only at the confirmation step', async () => {
    // By the confirmation step the wording is finished and the only answer to
    // a third part is to go back, so the count has to move while it is being
    // written.
    api.field.mockResolvedValue(sentInvoice())
    renderPage()
    fillNamePhoneAmount()

    const body = screen.getByLabelText('SMSの文面', { exact: false })
    expect(screen.getByText(/118文字・2通ぶん/)).toBeTruthy()

    fireEvent.change(body, {
      target: { value: 'キャンセル料{amount}円。支払期限{dueDate}。{url}' },
    })
    expect(screen.getByText(/88文字・2通ぶん/)).toBeTruthy()

    // Short enough to stop splitting at all.
    fireEvent.change(body, { target: { value: '{url}' } })
    expect(screen.getByText(/61文字・1通ぶん/)).toBeTruthy()
  })

  it('counts the amount the message quotes, tax included', async () => {
    // The message asks for what the guest owes. Counting the fee before tax
    // would report a different length from the one that goes out.
    api.field.mockResolvedValue(sentInvoice())
    renderPage()
    fillNamePhoneAmount()

    // 5000 + 500 would still be four digits wide, so the count only moves
    // once the total gains one: 5000 + 12500 = 17500.
    fireEvent.change(screen.getByLabelText('税額', { exact: false }), {
      target: { value: '12500' },
    })
    expect(screen.getByText(/119文字・2通ぶん/)).toBeTruthy()
  })

  it('leaves the SMS preview out when nothing is going by SMS', async () => {
    api.field.mockResolvedValue(sentInvoice())
    renderPage()
    fireEvent.change(screen.getByLabelText('請求先の名前', { exact: false }), {
      target: { value: '山田 太郎' },
    })
    fireEvent.change(screen.getByLabelText('送り先のメール', { exact: false }), {
      target: { value: 'guest@example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')

    expect(screen.queryByText('送られるSMSの文面')).toBeNull()
  })
})
