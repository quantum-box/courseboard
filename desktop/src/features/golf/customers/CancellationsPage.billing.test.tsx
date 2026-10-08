/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../../hooks/useResource'
import { i18next } from '../../../i18n'
import { CancellationsPage } from './CancellationsPage'

const api = vi.hoisted(() => ({ course: vi.fn(), field: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.course, fieldApiJson: api.field }
})

vi.mock('../../../context/TenantTimezoneProvider', () => ({
  useTenantTimezone: () => 'Asia/Tokyo',
}))

function cancellation(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: 'res_1',
    reservationNumber: 'RSV-1001',
    customerId: 'cus_1',
    customerName: '本田 康彦',
    customerEmail: 'honda@example.com',
    billable: true,
    playedOn: '2026-06-10',
    players: 4,
    bookingAmount: 48_000,
    reason: 'no_contact',
    reasonNote: '連絡がつかず',
    feeExpected: true,
    noticeDays: 0,
    feeState: 'unsettled',
    cancelledAt: '2026-06-10T01:00:00Z',
    ...overrides,
  }
}

function mockField() {
  api.field.mockResolvedValue({ id: 'inv_1', invoiceNumber: 'INV-1' })
}

function invoicePosts() {
  return api.field.mock.calls.filter(call => call[0] === '/v1/cancellation-fees')
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <CancellationsPage />
    </I18nextProvider>,
  )
}

function bodyOf(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, any>
}

function settlementCall() {
  return api.course.mock.calls.find(
    call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
  )
}

describe('the cancellation extraction', () => {
  beforeEach(async () => {
    api.course.mockReset()
    api.field.mockReset()
    vi.stubGlobal('crypto', { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' })
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  async function selectAllAndOpenSheet() {
    await act(async () => {
      fireEvent.click(screen.getByLabelText('このページをすべて選ぶ'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    })
  }

  async function pressBill() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /を請求する$/ }))
    })
  }

  it('opens on chargeable unsettled cancellations and shows their reason', async () => {
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })

    await act(async () => {
      renderPage()
    })

    const query = api.course.mock.calls[0]?.[0] as string
    expect(query).toContain('feeStates=unsettled')
    expect(query).toContain('feeExpectedOnly=true')
    const rows = within(screen.getByRole('table'))
    expect(rows.getByText('連絡なし')).toBeTruthy()
    expect(rows.getByText('連絡がつかず')).toBeTruthy()
  })

  it('creates one dedicated snapshot invoice per customer and records every booking', async () => {
    api.course.mockResolvedValue({
      items: [
        cancellation({ reservationId: 'res_1', players: 4 }),
        cancellation({ reservationId: 'res_2', players: 2 }),
      ],
      total: 2,
    })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(1))

    const invoiceBody = bodyOf(invoicePosts()[0]!)
    expect(invoiceBody.billTo).toEqual({ name: '本田 康彦', email: 'honda@example.com' })
    expect(invoiceBody.lineItems[0].unitPrice).toBe(18_000)
    expect(invoiceBody.idempotencyKey).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(invoiceBody).not.toHaveProperty('clientId')
    expect(invoiceBody).not.toHaveProperty('sources')
    expect(invoiceBody).not.toHaveProperty('status')
    expect(invoiceBody).not.toHaveProperty('purpose')
    expect(api.field.mock.calls.some(call => String(call[0]).startsWith('/v1/invoices'))).toBe(false)
    expect(api.field.mock.calls.some(call => String(call[0]).endsWith('/v1/cancellation-fees/inv_1/fulfill'))).toBe(true)

    const settle = settlementCall()
    expect(settle).toBeTruthy()
    const decisions = JSON.parse(String((settle?.[1] as RequestInit).body)).decisions
    expect(decisions).toHaveLength(2)
    expect(decisions.every((decision: { state: string; invoiceId: string }) =>
      decision.state === 'invoiced' && decision.invoiceId === 'inv_1')).toBe(true)
  })

  it('sends an unlinked booking as the entered snapshot without a ledger or reservation id', async () => {
    api.course.mockResolvedValue({
      items: [cancellation({
        reservationId: 'res_1',
        customerId: null,
        billable: false,
        customerEmail: null,
        players: 2,
      })],
      total: 1,
    })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('電話番号', { exact: false }), {
        target: { value: '090-0000-0000' },
      })
    })
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(1))

    const invoiceBody = bodyOf(invoicePosts()[0]!)
    expect(invoiceBody.billTo).toEqual({ name: '本田 康彦', phone: '+819000000000' })
    expect(invoiceBody.lineItems[0].unitPrice).toBe(6_000)
    expect(invoiceBody.billTo).not.toHaveProperty('kind')
    expect(invoiceBody).not.toHaveProperty('clientId')
    expect(invoiceBody).not.toHaveProperty('sources')
  })

  it('turns a selected customer into a snapshot without sending its ledger id', async () => {
    api.course.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/course/customers')) {
        return { items: [{ id: 'cus_9', name: '本田 康彦', email: 'honda@example.com' }] }
      }
      if (path.startsWith('/v1/course/reservation-cancellations?')) {
        return {
          items: [cancellation({
            reservationId: 'res_1',
            customerId: null,
            billable: false,
            customerName: '本田',
            customerEmail: null,
            players: 1,
          })],
          total: 1,
        }
      }
      return {}
    })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await act(async () => {
      fireEvent.focusIn(screen.getByLabelText('請求先の名前', { exact: false }))
    })
    const candidate = await screen.findByRole('button', { name: /本田 康彦/ })
    await act(async () => {
      fireEvent.click(candidate)
    })
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(1))

    const invoiceBody = bodyOf(invoicePosts()[0]!)
    expect(invoiceBody.billTo).toEqual({ name: '本田 康彦', email: 'honda@example.com' })
    expect(invoiceBody).not.toHaveProperty('clientId')
    expect(invoiceBody).not.toHaveProperty('sources')
  })

  it('starts a new operation after settlement succeeds', async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174001')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174002')
    vi.stubGlobal('crypto', { randomUUID })
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(1))
    const firstKey = bodyOf(invoicePosts()[0]!).idempotencyKey

    await selectAllAndOpenSheet()
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(2))
    expect(bodyOf(invoicePosts()[1]!).idempotencyKey).not.toBe(firstKey)

    await selectAllAndOpenSheet()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('1名あたりの金額', { exact: false }), {
        target: { value: '9000' },
      })
    })
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(3))
    expect(bodyOf(invoicePosts()[2]!).idempotencyKey).not.toBe(
      bodyOf(invoicePosts()[1]!).idempotencyKey,
    )
  })

  it('keeps the group key when the CourseBoard write-back fails', async () => {
    const firstKey = '123e4567-e89b-42d3-a456-426614174000'
    const secondKey = '123e4567-e89b-42d3-a456-426614174001'
    const randomUUID = vi.fn()
      .mockReturnValueOnce(firstKey)
      .mockReturnValueOnce(secondKey)
    vi.stubGlobal('crypto', { randomUUID })
    let settlementAttempts = 0
    api.course.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/course/reservation-cancellations?')) {
        return { items: [cancellation()], total: 1 }
      }
      if (path === '/v1/course/reservation-cancellations/fees') {
        settlementAttempts += 1
        if (settlementAttempts === 1) throw new Error('write-back unavailable')
        return {}
      }
      return {}
    })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(1))
    await waitFor(() => expect(settlementAttempts).toBe(1))
    expect(bodyOf(invoicePosts()[0]!).idempotencyKey).toBe(firstKey)

    cleanup()
    clearResourceCache()
    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('1名あたりの金額', { exact: false }), {
        target: { value: '9000' },
      })
    })
    await pressBill()
    await waitFor(() => expect(invoicePosts()).toHaveLength(2))
    expect(bodyOf(invoicePosts()[1]!).idempotencyKey).toBe(firstKey)
  })

  it('does not write CourseBoard settlement when the dedicated create fails', async () => {
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    api.field.mockRejectedValue(new Error('field is down'))

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()

    await waitFor(() => expect(invoicePosts()).toHaveLength(1))
    expect(settlementCall()).toBeUndefined()
  })
})
