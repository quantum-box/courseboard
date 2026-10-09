/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, configureApiAuth } from '../../api'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CancellationFeeDetailPage, CancellationFeesPage, NewCancellationFeePage } from './CancellationFeesPage'

const api = vi.hoisted(() => ({ field: vi.fn() }))
const router = vi.hoisted(() => ({ navigate: vi.fn() }))
const access = vi.hoisted(() => ({ list: true, manage: true }))

vi.mock('../../auth/EffectiveCapabilitiesProvider', async importOriginal => {
  const actual = await importOriginal<typeof import('../../auth/EffectiveCapabilitiesProvider')>()
  return {
    ...actual,
    useEffectiveCapabilities: () => ({ capabilities: {
      actions: {},
      navigation: { otherBusinessAccess: false },
      cancellationFees: access,
      agentDocuments: {
        invoices: { list: false, send: false },
        quotations: { list: false, send: false },
      },
    } }),
  }
})

beforeEach(() => {
  access.list = true
  access.manage = true
})

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
  configureApiAuth(null)
  sessionStorage.clear()
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
  return render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <NewCancellationFeePage />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

function renderDetailPage() {
  render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <PageReloadProvider>
          <CancellationFeeDetailPage invoiceId="inv_1" />
        </PageReloadProvider>
      </TooltipProvider>
    </I18nextProvider>,
  )
}

function checkbox(name: RegExp) {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement
}

describe('cancellation fee action guards', () => {
  it('rejects a saved create URL without mounting the form or making a request', () => {
    access.manage = false
    renderPage()
    expect(screen.getByRole('alert').textContent).toContain('権限がありません')
    expect(screen.queryByRole('button', { name: '送る内容を確認する' })).toBeNull()
    expect(api.field).not.toHaveBeenCalled()
  })

  it('rejects a detail URL without List even when Manage is present', () => {
    access.list = false
    renderDetailPage()
    expect(screen.getByRole('alert').textContent).toContain('権限がありません')
    expect(api.field).not.toHaveBeenCalled()
  })

  it('keeps a list-only invoice readable without mutation controls', async () => {
    access.manage = false
    api.field.mockResolvedValue(invoice({ clientEmail: 'client@example.com' }))
    renderDetailPage()
    await screen.findByText('INV-1')
    expect(screen.queryByRole('button', { name: /再送/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /更新/ })).toBeNull()
    expect(screen.queryByLabelText('送り先のメールアドレス')).toBeNull()
    expect(api.field.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true)
  })

  it('removes Create from a list-only list', async () => {
    access.manage = false
    api.field.mockResolvedValue({ items: [] })
    render(<I18nextProvider i18n={i18next}><TooltipProvider><PageReloadProvider>
      <CancellationFeesPage />
    </PageReloadProvider></TooltipProvider></I18nextProvider>)
    await waitFor(() => expect(api.field).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '請求を作る' })).toBeNull()
    expect(router.navigate).not.toHaveBeenCalled()
  })
})

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

function fillLinkOnlySnapshot(name = '山田 太郎') {
  fireEvent.click(checkbox(/請求書と支払いリンク/))
  fireEvent.change(screen.getByLabelText('請求先の名前', { exact: false }), {
    target: { value: name },
  })
}

function fillEmailSnapshot(email = 'wrong@example.com') {
  fireEvent.change(screen.getByLabelText('請求先の名前', { exact: false }), {
    target: { value: '山田 太郎' },
  })
  fireEvent.change(screen.getByLabelText('送り先のメール', { exact: false }), {
    target: { value: email },
  })
}

function bodyOf(call: unknown[]) {
  const init = call[1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, any>
}

function configureTestUser(userId: string) {
  configureApiAuth({
    tenantId: 'tenant_test',
    operatorId: 'operator_test',
    platformId: 'platform_test',
    userId,
    getAccessToken: async () => undefined,
    onUnauthorized: vi.fn(),
    onForbidden: vi.fn(),
  })
}

describe('the dedicated cancellation fee form', () => {
  beforeEach(() => {
    configureTestUser('user_test')
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
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/fulfill'))).toBe(false)
  })

  it('does not offer customer registration, arbitrary ids, or free SMS text', () => {
    renderPage()

    expect(screen.queryByLabelText(/顧客ID/)).toBeNull()
    expect(screen.queryByText(/顧客台帳にも登録/)).toBeNull()
    expect(screen.queryByLabelText(/SMSの文面/)).toBeNull()
    expect(screen.queryByLabelText(/請求先の種類/)).toBeNull()
  })

  it('confirms a manage-only creation without navigating to a forbidden detail', async () => {
    access.list = false
    api.field.mockResolvedValue(invoice({ status: 'Draft', emailDeliveryStatus: null, smsDeliveryStatus: null }))
    renderPage()
    fillLinkOnlySnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求の処理が完了しました')
    expect(screen.getByText('請求 INV-1 の処理が完了しました。')).toBeTruthy()
    expect(router.navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '一覧へ戻る' })).toBeNull()
    expect(api.field.mock.calls.filter(call => String(call[0]) === '/v1/cancellation-fees')).toHaveLength(1)
    expect(api.field.mock.calls.every(call => call[1]?.method === 'POST')).toBe(true)
  })

  it('opens a link-only draft when Field returns a ready payment link', async () => {
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        return invoice({
          status: 'Draft',
          emailDeliveryStatus: null,
          smsDeliveryStatus: null,
        })
      }
      throw new Error(`unexpected cancellation-fee request: ${path} ${init?.method ?? 'GET'}`)
    })
    renderPage()
    fillLinkOnlySnapshot()

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))

    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))
    const create = api.field.mock.calls.find(call => call[0] === '/v1/cancellation-fees')!
    expect(bodyOf(create)).toMatchObject({ sendEmail: false, sendSms: false })
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/fulfill'))).toBe(false)
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/send'))).toBe(false)
  })

  it('fulfills a draft with pending delivery before using the resend endpoint', async () => {
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees/inv_1') {
        return invoice({
          status: 'Draft',
          emailDeliveryStatus: 'Pending',
          smsDeliveryStatus: 'Pending',
        })
      }
      if (path.endsWith('/fulfill')) return invoice()
      if (path.endsWith('/send')) throw new Error('draft must use initial fulfilment')
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    renderDetailPage()

    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(
      api.field.mock.calls.some(call => String(call[0]).endsWith('/fulfill')),
    ).toBe(true))
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/send'))).toBe(false)
  })

  it('sends an email added to a link-only draft through the explicit resend action', async () => {
    let detailLoads = 0
    let sendAttempts = 0
    let resolveRefresh!: (value: unknown) => void
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees/inv_1' && !init?.method) {
        detailLoads += 1
        if (detailLoads === 1) {
          return invoice({
            status: 'Draft',
            paymentLinkStatus: 'Ready',
            paymentLinkUrl: 'https://example.com/pay/inv_1',
            emailDeliveryStatus: null,
            smsDeliveryStatus: null,
            clientEmail: null,
          })
        }
        return new Promise(resolve => { resolveRefresh = resolve })
      }
      if (path === '/v1/cancellation-fees/inv_1' && init?.method === 'PATCH') {
        return invoice({
          status: 'Draft',
          paymentLinkStatus: 'Ready',
          paymentLinkUrl: 'https://example.com/pay/inv_1',
          emailDeliveryStatus: null,
          smsDeliveryStatus: null,
          clientEmail: 'added@example.com',
        })
      }
      if (path.endsWith('/fulfill')) throw new Error('link-only email must use explicit resend')
      if (path.endsWith('/send')) {
        sendAttempts += 1
        return invoice({ status: 'Sent', emailDeliveryStatus: 'Sent', smsDeliveryStatus: null })
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    renderDetailPage()

    const email = await screen.findByLabelText('送信先メールアドレス')
    fireEvent.change(email, { target: { value: 'added@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(api.field.mock.calls.some(
      call => call[0] === '/v1/cancellation-fees/inv_1' && (call[1] as RequestInit)?.method === 'PATCH',
    )).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sendAttempts).toBe(1))
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/fulfill'))).toBe(false)
    const send = api.field.mock.calls.find(call => String(call[0]).endsWith('/send'))!
    expect(bodyOf(send)).toMatchObject({ sendEmail: true, sendSms: false })
    resolveRefresh(invoice({
      status: 'Draft',
      paymentLinkStatus: 'Ready',
      paymentLinkUrl: 'https://example.com/pay/inv_1',
      emailDeliveryStatus: null,
      smsDeliveryStatus: null,
      clientEmail: 'added@example.com',
    }))
  })

  it('keeps initial fulfilment for a draft with pending SMS when email is added', async () => {
    let fulfillAttempts = 0
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees/inv_1' && !init?.method) {
        return invoice({
          status: 'Draft',
          paymentLinkStatus: 'Ready',
          paymentLinkUrl: 'https://example.com/pay/inv_1',
          emailDeliveryStatus: null,
          smsDeliveryStatus: 'Pending',
          clientEmail: null,
        })
      }
      if (path === '/v1/cancellation-fees/inv_1' && init?.method === 'PATCH') {
        return invoice({
          status: 'Draft',
          paymentLinkStatus: 'Ready',
          paymentLinkUrl: 'https://example.com/pay/inv_1',
          emailDeliveryStatus: null,
          smsDeliveryStatus: 'Pending',
          clientEmail: 'added@example.com',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return invoice({ status: 'Sent', emailDeliveryStatus: 'Sent', smsDeliveryStatus: 'Sent' })
      }
      if (path.endsWith('/send')) throw new Error('pending SMS must keep the initial fulfilment')
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    renderDetailPage()

    fireEvent.change(await screen.findByLabelText('送信先メールアドレス'), {
      target: { value: 'added@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(api.field.mock.calls.some(
      call => call[0] === '/v1/cancellation-fees/inv_1' && (call[1] as RequestInit)?.method === 'PATCH',
    )).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(fulfillAttempts).toBe(1))
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/send'))).toBe(false)
  })

  it('applies a completed fulfilment before an immediate resend click', async () => {
    let detailLoads = 0
    let fulfillAttempts = 0
    let sendAttempts = 0
    let resolveRefresh!: (value: unknown) => void
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees/inv_1') {
        detailLoads += 1
        if (detailLoads === 1) {
          return invoice({
            status: 'Draft',
            emailDeliveryStatus: 'Pending',
            smsDeliveryStatus: 'Pending',
          })
        }
        return new Promise(resolve => { resolveRefresh = resolve })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        if (fulfillAttempts > 1) throw new Error('completed draft must not fulfil twice')
        return invoice({ status: 'Sent', emailDeliveryStatus: 'Sent', smsDeliveryStatus: 'Sent' })
      }
      if (path.endsWith('/send')) {
        sendAttempts += 1
        return invoice({ status: 'Sent', emailDeliveryStatus: 'Sent', smsDeliveryStatus: 'Sent' })
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    renderDetailPage()

    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(fulfillAttempts).toBe(1))
    const resend = await screen.findByRole('button', { name: 'リンクを作って送り直す' })
    await waitFor(() => expect((resend as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByText('送りました')).toBeTruthy()

    fireEvent.click(resend)
    await waitFor(() => expect(sendAttempts).toBe(1))
    expect(fulfillAttempts).toBe(1)
    resolveRefresh(invoice({ status: 'Sent', emailDeliveryStatus: 'Sent', smsDeliveryStatus: 'Sent' }))
  })

  it('rotates the resend key after every definitive partial or complete response', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn()
        .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000')
        .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174001')
        .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174002'),
    })
    let sendAttempts = 0
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees/inv_1') {
        return invoice({
          status: 'Sent',
          emailDeliveryStatus: 'Sent',
          smsDeliveryStatus: 'Sent',
        })
      }
      if (path.endsWith('/fulfill')) throw new Error('completed invoice must use explicit resend')
      if (path.endsWith('/send')) {
        sendAttempts += 1
        return sendAttempts === 1
          ? invoice({
              status: 'SendFailed',
              emailDeliveryStatus: 'Failed',
              smsDeliveryStatus: 'Failed',
              smsDeliveryFailureCode: 'BillingNotReady',
            })
          : invoice({ emailDeliveryStatus: 'Sent', smsDeliveryStatus: 'Sent' })
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    renderDetailPage()

    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sendAttempts).toBe(1))
    const firstSend = api.field.mock.calls.find(call => String(call[0]).endsWith('/send'))!
    const firstKey = bodyOf(firstSend).idempotencyKey

    fireEvent.click(screen.getByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sendAttempts).toBe(2))
    const sends = api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))
    const secondKey = bodyOf(sends[1]!).idempotencyKey
    expect(secondKey).not.toBe(firstKey)

    fireEvent.click(screen.getByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sendAttempts).toBe(3))
    const completedSends = api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))
    expect(bodyOf(completedSends[2]!).idempotencyKey).not.toBe(secondKey)
  })

  it('keeps Detail resend and invoice edits locked until an unknown send is retried', async () => {
    const sends: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees/inv_1') return invoice({
        status: 'Sent',
        clientEmail: 'customer@example.com',
        emailDeliveryStatus: 'Sent',
        smsDeliveryStatus: null,
      })
      if (path.endsWith('/fulfill')) throw new Error('completed invoice must use /send')
      if (path.endsWith('/send')) {
        return new Promise((resolve, reject) => sends.push({ resolve, reject }))
      }
      if (path === '/v1/cancellation-fees/inv_1') throw new Error('unexpected request')
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    renderDetailPage()

    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sends).toHaveLength(1))
    const firstSend = api.field.mock.calls.find(call => String(call[0]).endsWith('/send'))!
    const firstBody = bodyOf(firstSend)
    expect((screen.getByLabelText('送信先メールアドレス') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '変更する' }) as HTMLButtonElement).disabled).toBe(true)

    sends[0]!.reject(new Error('send response lost'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((screen.getByLabelText('送信先メールアドレス') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '変更する' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sends).toHaveLength(2))
    const resendBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[1]!)
    expect(resendBody).toMatchObject({
      idempotencyKey: firstBody.idempotencyKey,
      sendEmail: firstBody.sendEmail,
      sendSms: firstBody.sendSms,
    })
    sends[1]!.resolve(invoice({ status: 'Sent', clientEmail: 'customer@example.com', emailDeliveryStatus: 'Sent' }))
  })

  it('replays a pending Detail send after reload without fulfil or patch', async () => {
    let fulfillAttempts = 0
    let patchAttempts = 0
    const sends: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees/inv_1' && !init?.method) {
        return invoice({
          status: 'Sent',
          clientEmail: 'customer@example.com',
          emailDeliveryStatus: 'Sent',
          smsDeliveryStatus: null,
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        throw new Error('pending resend must not fall back to fulfil')
      }
      if (path.endsWith('/send')) {
        return new Promise((resolve, reject) => sends.push({ resolve, reject }))
      }
      if (init?.method === 'PATCH') {
        patchAttempts += 1
        throw new Error('pending resend must block PATCH')
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })

    renderDetailPage()
    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sends).toHaveLength(1))
    const firstBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[0]!)

    cleanup()
    renderDetailPage()
    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sends).toHaveLength(2))
    const replayBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[1]!)
    expect(replayBody).toMatchObject({
      idempotencyKey: firstBody.idempotencyKey,
      sendEmail: firstBody.sendEmail,
      sendSms: firstBody.sendSms,
    })
    expect(fulfillAttempts).toBe(0)
    expect(patchAttempts).toBe(0)
    sends[1]!.resolve(invoice({ status: 'Sent', clientEmail: 'customer@example.com', emailDeliveryStatus: 'Sent' }))
  })

  it('replays a pending initial Detail fulfilment after reload', async () => {
    let fulfillAttempts = 0
    let patchAttempts = 0
    const fulfils: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees/inv_1' && !init?.method) {
        return invoice({
          status: 'Draft',
          emailDeliveryStatus: 'Pending',
          smsDeliveryStatus: 'Pending',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return new Promise((resolve, reject) => fulfils.push({ resolve, reject }))
      }
      if (path.endsWith('/send')) throw new Error('pending initial fulfilment must not use /send')
      if (init?.method === 'PATCH') {
        patchAttempts += 1
        throw new Error('pending initial fulfilment must block PATCH')
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })

    renderDetailPage()
    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(fulfils).toHaveLength(1))

    cleanup()
    renderDetailPage()
    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(fulfils).toHaveLength(2))
    expect(fulfillAttempts).toBe(2)
    expect(patchAttempts).toBe(0)
    fulfils[1]!.resolve(invoice({ status: 'Sent', emailDeliveryStatus: 'Sent', smsDeliveryStatus: 'Sent' }))
  })

  it('does not let a late Detail send response cross tenant or user scope', async () => {
    const sends: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees/inv_1') return invoice({
        status: 'Sent',
        clientEmail: 'customer@example.com',
        emailDeliveryStatus: 'Sent',
        smsDeliveryStatus: null,
      })
      if (path.endsWith('/send')) {
        return new Promise((resolve, reject) => sends.push({ resolve, reject }))
      }
      if (path.endsWith('/fulfill')) throw new Error('completed invoice must use /send')
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })

    renderDetailPage()
    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sends).toHaveLength(1))
    const oldOperationKey = 'courseboard:cancellation-fee:delivery-operations:tenant_test:user_test:inv_1'
    const newOperationKey = 'courseboard:cancellation-fee:delivery-operations:tenant_test:user_b:inv_1'
    expect(sessionStorage.getItem(oldOperationKey)).not.toBeNull()

    cleanup()
    configureTestUser('user_b')
    renderDetailPage()
    await screen.findByText('INV-1')
    expect(sessionStorage.getItem(newOperationKey)).toBeNull()

    sends[0]!.resolve(invoice({ status: 'Sent', clientEmail: 'customer@example.com', emailDeliveryStatus: 'Sent' }))
    await waitFor(() => expect(sessionStorage.getItem(oldOperationKey)).not.toBeNull())
    expect(sessionStorage.getItem(newOperationKey)).toBeNull()
    expect(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))).toHaveLength(1)
  })

  it('disables Detail resend and edits for a void invoice', async () => {
    api.field.mockResolvedValue(invoice({
      status: 'Void',
      clientEmail: 'customer@example.com',
      emailDeliveryStatus: 'Failed',
      emailDeliveryFailureCode: 'BillingNotReady',
    }))
    renderDetailPage()

    await screen.findByText('INV-1')
    expect((screen.getByRole('button', { name: 'リンクを作って送り直す' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('送信先メールアドレス') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '変更する' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('retries the same initial delivery after its response times out', async () => {
    let fulfillAttempts = 0
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees') {
        return invoice({
          status: 'Draft',
          paymentLinkUrl: null,
          paymentLinkStatus: 'Pending',
          smsDeliveryStatus: 'Pending',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        if (fulfillAttempts === 1) throw new Error('initial delivery timed out')
        return invoice()
      }
      if (path.endsWith('/send')) throw new Error('explicit resend must wait for the operator')
      return invoice()
    })
    renderPage()
    fillSnapshot()

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(fulfillAttempts).toBe(1))
    expect(screen.getByRole('button', { name: '初回の送信をもう一度確認する' })).toBeTruthy()
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/send'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '初回の送信をもう一度確認する' }))
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))
    expect(fulfillAttempts).toBe(2)
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/send'))).toBe(false)
  })

  it('replays the same create key after fulfilment timeout and clears a completed Paid invoice', async () => {
    let createAttempts = 0
    let fulfillAttempts = 0
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees') {
        createAttempts += 1
        return createAttempts === 1
          ? invoice({
              status: 'Draft',
              paymentLinkUrl: null,
              paymentLinkStatus: 'Pending',
              emailDeliveryStatus: null,
              smsDeliveryStatus: 'Pending',
            })
          : invoice({
              status: 'Paid',
              paymentLinkUrl: null,
              paymentLinkStatus: 'Pending',
              smsDeliveryStatus: 'Failed',
            })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        if (fulfillAttempts === 1) throw new Error('initial delivery timed out')
        return invoice()
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    const firstRender = renderPage()
    fillSnapshot('初回の請求先', '090-0000-0000')

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(fulfillAttempts).toBe(1))

    firstRender.unmount()
    renderPage()
    expect(screen.getByText(/請求書はできていますが、最初のお知らせの結果を確認できていません/)).toBeTruthy()
    const recipient = screen.getByLabelText('請求先の名前', { exact: false }) as HTMLInputElement
    expect(recipient.disabled).toBe(true)
    fireEvent.change(recipient, { target: { value: '別の請求先' } })
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))

    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))
    expect(createAttempts).toBe(2)
    expect(fulfillAttempts).toBe(1)
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/send'))).toBe(false)
    const creates = api.field.mock.calls.filter(call => call[0] === '/v1/cancellation-fees')
    expect(creates).toHaveLength(2)
    expect(bodyOf(creates[1]!).idempotencyKey).toBe(bodyOf(creates[0]!).idempotencyKey)
    expect(sessionStorage.getItem('courseboard:cancellation-fee:create-recovery:tenant_test:user_test')).toBeNull()
  })

  it('freezes and restores a create whose response was lost before allowing another invoice', async () => {
    const creates: unknown[][] = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        creates.push([path, init])
        if (creates.length === 1) throw new Error('create response lost')
        return invoice()
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    const firstRender = renderPage()
    fillSnapshot('元の請求先', '090-0000-0000')

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('create response lost')

    const recipient = screen.getByLabelText('請求先の名前', { exact: false }) as HTMLInputElement
    expect(recipient.disabled).toBe(true)
    fireEvent.change(recipient, { target: { value: '別の請求先' } })
    fireEvent.click(screen.getByRole('button', { name: '戻って直す' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    firstRender.unmount()
    renderPage()
    expect(screen.getByText('同じ内容でやり直す')).toBeTruthy()
    expect(screen.getByText('元の請求先')).toBeTruthy()
    expect((screen.getByLabelText('請求先の名前', { exact: false }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))

    const firstBody = bodyOf(creates[0]!)
    const secondBody = bodyOf(creates[1]!)
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey)
    expect(secondBody.billTo).toEqual(firstBody.billTo)
    expect(secondBody.lineItems).toEqual(firstBody.lineItems)
    expect(secondBody.dueDate).toBe(firstBody.dueDate)
    expect(secondBody.taxAmount).toBe(firstBody.taxAmount)
    expect(secondBody.notes).toBe(firstBody.notes)
    expect(secondBody.sendEmail).toBe(firstBody.sendEmail)
    expect(secondBody.sendSms).toBe(firstBody.sendSms)
  })

  it('keeps an uncertain create after a replay auth failure', async () => {
    const creates: unknown[][] = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        creates.push([path, init])
        if (creates.length === 1) throw new Error('create response lost')
        if (creates.length === 2) throw new ApiError('権限を確認できません', 401)
        return invoice()
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })

    const firstRender = renderPage()
    fillSnapshot('認証切れ前の請求先', '090-0000-0000')
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('create response lost')
    firstRender.unmount()

    const retryRender = renderPage()
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('権限を確認できません')
    expect(sessionStorage.getItem('courseboard:cancellation-fee:create-recovery:tenant_test:user_test')).not.toBeNull()
    retryRender.unmount()

    // Re-authorize the same tenant/principal and retry the original body/key.
    configureTestUser('user_test')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))

    const firstBody = bodyOf(creates[0]!)
    expect(bodyOf(creates[1]!).idempotencyKey).toBe(firstBody.idempotencyKey)
    expect(bodyOf(creates[2]!).idempotencyKey).toBe(firstBody.idempotencyKey)
    expect(bodyOf(creates[2]!).billTo).toEqual(firstBody.billTo)
  })

  it('does not restore another user’s unresolved create in the same tenant', async () => {
    let createAttempts = 0
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees') {
        createAttempts += 1
        throw new Error('create response lost')
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    configureTestUser('user_a')
    const userARender = renderPage()
    fillSnapshot('ユーザーAの請求先')
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('create response lost')
    fireEvent.click(screen.getByRole('button', { name: '戻って直す' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    userARender.unmount()

    configureTestUser('user_b')
    const userBRender = renderPage()
    expect(screen.queryByText('前回の請求作成を確認してください')).toBeNull()
    expect((screen.getByLabelText('請求先の名前', { exact: false }) as HTMLInputElement).disabled).toBe(false)
    expect(createAttempts).toBe(1)
    userBRender.unmount()

    configureTestUser('user_a')
    renderPage()
    expect(screen.getByText('前回の請求作成を確認してください')).toBeTruthy()
    expect(screen.getByText('ユーザーAの請求先')).toBeTruthy()
  })

  it('replays the initial delivery when the create response reports SendFailed', async () => {
    let fulfillAttempts = 0
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees') {
        return invoice({
          status: 'SendFailed',
          smsDeliveryStatus: 'Failed',
          smsDeliveryFailureCode: 'Timeout',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return invoice({
          status: 'SendFailed',
          smsDeliveryStatus: 'Failed',
          smsDeliveryFailureCode: 'Timeout',
        })
      }
      if (path.endsWith('/send')) throw new Error('explicit resend must wait for the operator')
      return invoice()
    })
    renderPage()
    fillSnapshot()

    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(
      api.field.mock.calls.some(call => String(call[0]).endsWith('/fulfill')),
    ).toBe(true))
    expect(fulfillAttempts).toBe(1)
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/send'))).toBe(false)
    expect(screen.getByRole('button', { name: '送信だけやり直す' })).toBeTruthy()
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
    await waitFor(() => expect(
      api.field.mock.calls.some(call => String(call[0]).endsWith('/fulfill')),
    ).toBe(true))

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

  it('lets a manage-only operator correct an invalid email before a fresh resend', async () => {
    let uuidCalls = 0
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `123e4567-e89b-42d3-a456-${(uuidCalls++).toString(16).padStart(12, '0')}`),
    })
    access.list = false
    let fulfillAttempts = 0
    let patchAttempts = 0
    let sendAttempts = 0
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path === '/v1/cancellation-fees/inv_1' && init?.method === 'PATCH') {
        patchAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'fixed@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/send')) {
        sendAttempts += 1
        return invoice({
          status: 'Sent',
          clientEmail: 'fixed@example.com',
          emailDeliveryStatus: 'Sent',
        })
      }
      throw new Error(`unexpected cancellation-fee request: ${path} ${init?.method ?? 'GET'}`)
    })

    renderPage()
    fillEmailSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(fulfillAttempts).toBe(1))

    const create = api.field.mock.calls.find(call => call[0] === '/v1/cancellation-fees')!
    const correction = await screen.findByLabelText('送信先メールアドレス', { exact: false })
    expect((correction as HTMLInputElement).value).toBe('wrong@example.com')
    fireEvent.change(correction, { target: { value: 'fixed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))

    await waitFor(() => expect(patchAttempts).toBe(1))
    const patchCall = api.field.mock.calls.find(call => (
      call[0] === '/v1/cancellation-fees/inv_1'
      && (call[1] as RequestInit)?.method === 'PATCH'
    ))!
    expect(bodyOf(patchCall)).toEqual({ clientEmail: 'fixed@example.com' })
    expect(api.field.mock.calls.filter(call => call[0] === '/v1/cancellation-fees')).toHaveLength(1)
    expect(sendAttempts).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(sendAttempts).toBe(1))
    const send = api.field.mock.calls.find(call => String(call[0]).endsWith('/send'))!
    expect(bodyOf(send)).toMatchObject({
      sendEmail: true,
      sendSms: false,
    })
    expect(bodyOf(send).idempotencyKey).not.toBe(bodyOf(create).idempotencyKey)
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it('locks a corrected destination while resend is uncertain and retries the same send key', async () => {
    access.list = false
    let patchAttempts = 0
    const sends: Array<{
      resolve: (value: unknown) => void
      reject: (reason?: unknown) => void
    }> = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path === '/v1/cancellation-fees/inv_1' && init?.method === 'PATCH') {
        patchAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'fixed@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/fulfill')) {
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/send')) {
        return new Promise((resolve, reject) => sends.push({ resolve, reject }))
      }
      throw new Error(`unexpected cancellation-fee request: ${path} ${init?.method ?? 'GET'}`)
    })

    renderPage()
    fillEmailSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')

    const correction = await screen.findByLabelText('送信先メールアドレス', { exact: false })
    fireEvent.change(correction, { target: { value: 'fixed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(patchAttempts).toBe(1))

    const resend = screen.getByRole('button', { name: '送信だけやり直す' })
    fireEvent.click(resend)
    await waitFor(() => expect(sends).toHaveLength(1))
    expect((correction as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '変更する' }) as HTMLButtonElement).disabled).toBe(true)
    const firstSendBody = bodyOf(api.field.mock.calls.find(call => String(call[0]).endsWith('/send'))!)

    sends[0]!.reject(new Error('send response lost'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('send response lost'))
    expect((screen.getByLabelText('送信先メールアドレス', { exact: false }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '変更する' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(sends).toHaveLength(2))
    const secondSendBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[1]!)
    expect(secondSendBody).toMatchObject({
      idempotencyKey: firstSendBody.idempotencyKey,
      sendEmail: firstSendBody.sendEmail,
      sendSms: firstSendBody.sendSms,
    })
    sends[1]!.resolve(invoice({ status: 'Sent', clientEmail: 'fixed@example.com', emailDeliveryStatus: 'Sent' }))
  })

  it('replays the frozen create and the same pending send after reload without fulfil or patch', async () => {
    access.list = false
    let createAttempts = 0
    let fulfillAttempts = 0
    let patchAttempts = 0
    const sends: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        createAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path === '/v1/cancellation-fees/inv_1' && init?.method === 'PATCH') {
        patchAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'fixed@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/send')) {
        return new Promise((resolve, reject) => sends.push({ resolve, reject }))
      }
      throw new Error(`unexpected cancellation-fee request: ${path} ${init?.method ?? 'GET'}`)
    })

    const firstPage = renderPage()
    fillEmailSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(fulfillAttempts).toBe(1))
    const correction = await screen.findByLabelText('送信先メールアドレス', { exact: false })
    fireEvent.change(correction, { target: { value: 'fixed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(patchAttempts).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(sends).toHaveLength(1))
    const creates = () => api.field.mock.calls.filter(call => call[0] === '/v1/cancellation-fees')
    const firstCreateBody = bodyOf(creates()[0]!)
    const firstSendBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[0]!)
    firstPage.unmount()

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(createAttempts).toBe(2))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(fulfillAttempts).toBe(1)
    expect(patchAttempts).toBe(1)
    expect(bodyOf(creates()[1]!)).toEqual(firstCreateBody)
    const replaySendBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[1]!)
    expect(replaySendBody).toMatchObject({
      idempotencyKey: firstSendBody.idempotencyKey,
      sendEmail: firstSendBody.sendEmail,
      sendSms: firstSendBody.sendSms,
    })
    sends[1]!.resolve(invoice({ status: 'Sent', clientEmail: 'fixed@example.com', emailDeliveryStatus: 'Sent' }))
  })

  it('ignores a late resend response after tenant and user scope change', async () => {
    access.list = false
    let createAttempts = 0
    let fulfillAttempts = 0
    let patchAttempts = 0
    const sends: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        createAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path === '/v1/cancellation-fees/inv_1' && init?.method === 'PATCH') {
        patchAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'fixed@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/send')) return new Promise((resolve, reject) => sends.push({ resolve, reject }))
      throw new Error(`unexpected cancellation-fee request: ${path} ${init?.method ?? 'GET'}`)
    })

    const oldPage = renderPage()
    fillEmailSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(fulfillAttempts).toBe(1))
    const correction = await screen.findByLabelText('送信先メールアドレス', { exact: false })
    fireEvent.change(correction, { target: { value: 'fixed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(patchAttempts).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(sends).toHaveLength(1))
    const oldRecoveryKey = 'courseboard:cancellation-fee:create-recovery:tenant_test:user_test'
    const newRecoveryKey = 'courseboard:cancellation-fee:create-recovery:tenant_test:user_b'
    const oldRecoveryBefore = sessionStorage.getItem(oldRecoveryKey)
    expect(oldRecoveryBefore).not.toBeNull()

    oldPage.unmount()
    configureTestUser('user_b')
    renderPage()
    expect(screen.getByRole('button', { name: '送る内容を確認する' })).toBeTruthy()
    expect(screen.queryByText('請求書は作れました')).toBeNull()
    expect(sessionStorage.getItem(newRecoveryKey)).toBeNull()

    sends[0]!.resolve(invoice({ status: 'Sent', clientEmail: 'fixed@example.com', emailDeliveryStatus: 'Sent' }))
    await waitFor(() => expect(sends).toHaveLength(1))
    expect(createAttempts).toBe(1)
    expect(fulfillAttempts).toBe(1)
    expect(patchAttempts).toBe(1)
    expect(sessionStorage.getItem(oldRecoveryKey)).toBe(oldRecoveryBefore)
    expect(sessionStorage.getItem(newRecoveryKey)).toBeNull()
    expect(screen.queryByText('請求書は作れました')).toBeNull()
  })

  it('replays a lost recipient patch with the same email and removes it after a definite response', async () => {
    access.list = false
    let createAttempts = 0
    let fulfillAttempts = 0
    let patchAttempts = 0
    let sendAttempts = 0
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        createAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path === '/v1/cancellation-fees/inv_1' && init?.method === 'PATCH') {
        patchAttempts += 1
        if (patchAttempts === 1) throw new Error('patch response lost')
        return invoice({
          status: 'SendFailed',
          clientEmail: 'fixed@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return invoice({
          status: 'SendFailed',
          clientEmail: 'wrong@example.com',
          emailDeliveryStatus: 'Failed',
          emailDeliveryFailureCode: 'InvalidDestination',
        })
      }
      if (path.endsWith('/send')) {
        sendAttempts += 1
        return invoice({ status: 'Sent', clientEmail: 'fixed@example.com', emailDeliveryStatus: 'Sent' })
      }
      throw new Error(`unexpected cancellation-fee request: ${path} ${init?.method ?? 'GET'}`)
    })

    const firstPage = renderPage()
    fillEmailSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(fulfillAttempts).toBe(1))

    const correction = await screen.findByLabelText('送信先メールアドレス', { exact: false })
    fireEvent.change(correction, { target: { value: 'fixed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(patchAttempts).toBe(1))
    expect(screen.getByText(/送り先の変更結果を確認できません/)).toBeTruthy()
    firstPage.unmount()

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(patchAttempts).toBe(2))
    expect(fulfillAttempts).toBe(1)

    const recovery = JSON.parse(
      sessionStorage.getItem('courseboard:cancellation-fee:create-recovery:tenant_test:user_test')!,
    ) as { recipientPatch?: unknown; initialDeliverySettled?: boolean }
    expect(recovery.recipientPatch).toBeUndefined()
    expect(recovery.initialDeliverySettled).toBe(true)
    const patches = api.field.mock.calls.filter(call => (
      call[0] === '/v1/cancellation-fees/inv_1'
      && (call[1] as RequestInit)?.method === 'PATCH'
    ))
    expect(bodyOf(patches[0]!).clientEmail).toBe('fixed@example.com')
    expect(bodyOf(patches[1]!).clientEmail).toBe('fixed@example.com')

    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(sendAttempts).toBe(1))
    expect(createAttempts).toBe(2)
  })

  it('does not retry delivery or patch a terminal invoice returned by create replay', async () => {
    let createAttempts = 0
    let fulfillAttempts = 0
    let sendAttempts = 0
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees') {
        createAttempts += 1
        return createAttempts === 1
          ? invoice({
              status: 'SendFailed',
              smsDeliveryStatus: 'Failed',
              smsDeliveryFailureCode: 'BillingNotReady',
            })
          : invoice({ status: 'Paid', smsDeliveryStatus: 'Failed' })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        return invoice({
          status: 'SendFailed',
          smsDeliveryStatus: 'Failed',
          smsDeliveryFailureCode: 'BillingNotReady',
        })
      }
      if (path.endsWith('/send')) {
        sendAttempts += 1
        throw new Error('send must not replay after terminal create response')
      }
      if (init?.method === 'PATCH') throw new Error('patch must not target a terminal invoice')
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })

    const firstPage = renderPage()
    fillSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(fulfillAttempts).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: '送信だけやり直す' }))
    await waitFor(() => expect(sendAttempts).toBe(1))
    firstPage.unmount()

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))
    expect(createAttempts).toBe(2)
    expect(fulfillAttempts).toBe(1)
    expect(sendAttempts).toBe(1)
  })

  it('retires the create recovery and key after detail delivery completes', async () => {
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees') {
        return invoice({
          status: 'SendFailed',
          smsDeliveryStatus: 'Failed',
          smsDeliveryFailureCode: 'BillingNotReady',
        })
      }
      if (path.endsWith('/fulfill')) {
        return invoice({
          status: 'SendFailed',
          smsDeliveryStatus: 'Failed',
          smsDeliveryFailureCode: 'BillingNotReady',
        })
      }
      if (path === '/v1/cancellation-fees/inv_1') {
        return invoice({ status: 'Sent', smsDeliveryStatus: 'Sent' })
      }
      if (path.endsWith('/send')) return invoice()
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })
    const newPage = renderPage()
    fillSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await screen.findByText('請求書は作れました')
    await waitFor(() => expect(
      api.field.mock.calls.some(call => String(call[0]).endsWith('/fulfill')),
    ).toBe(true))
    newPage.unmount()

    renderDetailPage()
    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(
      api.field.mock.calls.some(call => String(call[0]).endsWith('/send')),
    ).toBe(true))

    expect(sessionStorage.getItem('courseboard:cancellation-fee:create-recovery:tenant_test:user_test')).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('courseboard:cancellation-fee:create-keys:tenant_test:user_test')!)).toEqual({})
  })

  it('reuses a Detail lost-send operation when the operator returns to New', async () => {
    const createKey = '123e4567-e89b-42d3-a456-426614174001'
    const recoveryStorageKey = 'courseboard:cancellation-fee:create-recovery:tenant_test:user_test'
    sessionStorage.setItem(recoveryStorageKey, JSON.stringify({
      identity: 'cross-page-recovery',
      key: createKey,
      scope: 'tenant_test:user_test',
      invoiceId: 'inv_1',
      initialDeliverySettled: true,
      submission: {
        billTo: { name: '山田 太郎', email: 'customer@example.com' },
        recipientName: '山田 太郎',
        clientEmail: 'customer@example.com',
        dueDate: '2099-09-11',
        taxAmount: 0,
        notes: 'キャンセル料',
        description: 'キャンセル料',
        amount: 5000,
        sendEmail: true,
        sendSms: false,
      },
    }))
    let createAttempts = 0
    let fulfillAttempts = 0
    let patchAttempts = 0
    const sends: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/cancellation-fees/inv_1' && !init?.method) {
        return invoice({
          status: 'Sent',
          clientEmail: 'customer@example.com',
          emailDeliveryStatus: 'Sent',
          smsDeliveryStatus: null,
        })
      }
      if (path === '/v1/cancellation-fees' && init?.method === 'POST') {
        createAttempts += 1
        return invoice({
          status: 'Sent',
          clientEmail: 'customer@example.com',
          emailDeliveryStatus: 'Sent',
          smsDeliveryStatus: null,
        })
      }
      if (path.endsWith('/fulfill')) {
        fulfillAttempts += 1
        throw new Error('cross-page send must not fall back to fulfil')
      }
      if (path.endsWith('/send')) {
        return new Promise((resolve, reject) => sends.push({ resolve, reject }))
      }
      if (init?.method === 'PATCH') {
        patchAttempts += 1
        throw new Error('cross-page send must block recipient PATCH')
      }
      throw new Error(`unexpected cancellation-fee request: ${path} ${init?.method ?? 'GET'}`)
    })

    renderDetailPage()
    fireEvent.click(await screen.findByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sends).toHaveLength(1))
    const detailSendBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[0]!)
    cleanup()

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(createAttempts).toBe(1))
    await waitFor(() => expect(sends).toHaveLength(2))

    const create = api.field.mock.calls.find(call => (
      call[0] === '/v1/cancellation-fees' && (call[1] as RequestInit)?.method === 'POST'
    ))!
    expect(bodyOf(create).idempotencyKey).toBe(createKey)
    const newSendBody = bodyOf(api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))[1]!)
    expect(newSendBody).toMatchObject({
      idempotencyKey: detailSendBody.idempotencyKey,
      sendEmail: detailSendBody.sendEmail,
      sendSms: detailSendBody.sendSms,
    })
    expect(fulfillAttempts).toBe(0)
    expect(patchAttempts).toBe(0)
    sends[1]!.resolve(invoice({
      status: 'Sent',
      clientEmail: 'customer@example.com',
      emailDeliveryStatus: 'Sent',
      smsDeliveryStatus: null,
    }))
  })

  it('does not let a stale create completion replace a newer same-scope recovery', async () => {
    let uuidCalls = 0
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `123e4567-e89b-42d3-a456-${(uuidCalls++).toString(16).padStart(12, '0')}`),
    })
    let createAttempts = 0
    let resolveFirst!: (value: unknown) => void
    let resolveThird!: (value: unknown) => void
    api.field.mockImplementation(async (path: string) => {
      if (path === '/v1/cancellation-fees') {
        createAttempts += 1
        if (createAttempts === 1) {
          return new Promise(resolve => { resolveFirst = resolve })
        }
        if (createAttempts === 2) return invoice()
        return new Promise(resolve => { resolveThird = resolve })
      }
      throw new Error(`unexpected cancellation-fee request: ${path}`)
    })

    const firstPage = renderPage()
    fillSnapshot('古い請求先')
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(createAttempts).toBe(1))
    const firstKey = bodyOf(api.field.mock.calls[0]!).idempotencyKey
    firstPage.unmount()

    const replayPage = renderPage()
    expect(screen.getByText('前回の請求作成を確認してください')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(createAttempts).toBe(2))
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('cancellation-fees/inv_1'))
    replayPage.unmount()

    renderPage()
    fillSnapshot('新しい請求先')
    fireEvent.click(screen.getByRole('button', { name: '送る内容を確認する' }))
    await screen.findByText('この内容で送ります')
    fireEvent.click(screen.getByRole('button', { name: '請求を作って送る' }))
    await waitFor(() => expect(createAttempts).toBe(3))
    const recoveryStorageKey = 'courseboard:cancellation-fee:create-recovery:tenant_test:user_test'
    const newerRecovery = JSON.parse(sessionStorage.getItem(recoveryStorageKey)!) as { key: string }
    expect(newerRecovery.key).not.toBe(firstKey)

    resolveFirst(invoice({ status: 'Draft', paymentLinkUrl: null, paymentLinkStatus: 'Pending' }))
    await waitFor(() => expect(
      (JSON.parse(sessionStorage.getItem(recoveryStorageKey)!) as { key: string }).key,
    ).toBe(newerRecovery.key))

    resolveThird(invoice())
  })
})
