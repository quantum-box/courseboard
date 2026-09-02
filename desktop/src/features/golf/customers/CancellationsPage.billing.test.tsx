/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <CancellationsPage />
    </I18nextProvider>,
  )
}

describe('the cancellation extraction', () => {
  beforeEach(async () => {
    api.course.mockReset()
    api.field.mockReset()
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('opens on the chargeable cancellations nobody has settled, and shows why each one was', async () => {
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })

    await act(async () => {
      renderPage()
    })

    const query = api.course.mock.calls[0]?.[0] as string
    expect(query).toContain('feeStates=unsettled')
    expect(query).toContain('feeExpectedOnly=true')
    // The reason is the point of the screen: a list of dates and names is what
    // the club already had.
    // Scoped to the rows: the same words are in the reason filter above them.
    const rows = within(screen.getByRole('table'))
    expect(rows.getByText('連絡なし')).toBeTruthy()
    expect(rows.getByText('連絡がつかず')).toBeTruthy()
  })

  it('bills one invoice per person and records it against every booking on it', async () => {
    api.course.mockResolvedValue({
      items: [
        cancellation({ reservationId: 'res_1', players: 4 }),
        cancellation({ reservationId: 'res_2', players: 2 }),
      ],
      total: 2,
    })
    api.field.mockResolvedValue({ id: 'inv_1', invoiceNumber: 'INV-1' })

    await act(async () => {
      renderPage()
    })

    await act(async () => {
      fireEvent.click(screen.getByLabelText('この一覧をすべて選ぶ'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /を請求する$/ }))
    })

    // One person, two cancelled bookings, one invoice — not two bills the
    // caller has to reconcile themselves.
    expect(api.field).toHaveBeenCalledTimes(1)
    const invoiceBody = JSON.parse(
      (api.field.mock.calls[0]?.[1] as RequestInit).body as string,
    )
    expect(invoiceBody.billTo).toEqual({ kind: 'customer', customerId: 'cus_1' })
    // Six rounds given up at the default 3,000 each.
    expect(invoiceBody.lineItems[0].unitPrice).toBe(18_000)

    const settle = api.course.mock.calls.find(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )
    expect(settle).toBeTruthy()
    const decisions = JSON.parse((settle?.[1] as RequestInit).body as string).decisions
    expect(decisions).toHaveLength(2)
    expect(decisions.every((decision: { state: string; invoiceId: string }) =>
      decision.state === 'invoiced' && decision.invoiceId === 'inv_1')).toBe(true)
  })

  it('says which selected bookings cannot be billed rather than quietly leaving them out', async () => {
    api.course.mockResolvedValue({
      items: [cancellation({ reservationId: 'res_1', customerId: null, billable: false })],
      total: 1,
    })

    await act(async () => {
      renderPage()
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('この一覧をすべて選ぶ'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    })

    expect(screen.getByText('請求できない予約があります')).toBeTruthy()
  })

  it('never records a fee for an invoice that failed to be raised', async () => {
    // The order the whole flow depends on: a row marked invoiced that points at
    // nothing never comes back on the next extraction.
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    api.field.mockRejectedValue(new Error('field is down'))

    await act(async () => {
      renderPage()
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('この一覧をすべて選ぶ'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /を請求する$/ }))
    })

    expect(api.course.mock.calls.some(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )).toBe(false)
    expect(screen.getByText(/field is down/)).toBeTruthy()
  })
})
