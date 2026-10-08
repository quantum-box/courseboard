/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureApiAuth } from '../../api'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CancellationFeeDetailPage, NewCancellationFeePage } from './CancellationFeesPage'

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

  it('keeps the resend key for a partial response and rotates after completion', async () => {
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
    expect(bodyOf(sends[1]!)).toMatchObject({ idempotencyKey: firstKey })

    fireEvent.click(screen.getByRole('button', { name: 'リンクを作って送り直す' }))
    await waitFor(() => expect(sendAttempts).toBe(3))
    const completedSends = api.field.mock.calls.filter(call => String(call[0]).endsWith('/send'))
    expect(bodyOf(completedSends[2]!).idempotencyKey).not.toBe(firstKey)
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
