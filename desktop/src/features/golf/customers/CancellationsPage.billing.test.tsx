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

/**
 * Field answers two different calls here: the reverse lookup that guards
 * against billing twice, and the invoice creation itself.
 */
function mockField(billedSources: unknown[] = []) {
  api.field.mockImplementation(async (path: string) => {
    if (path.startsWith('/v1/invoices?')) return { items: billedSources }
    return { id: 'inv_1', invoiceNumber: 'INV-1' }
  })
}

/** The POST calls only — the guard's GET is not an invoice being raised. */
function invoicePosts() {
  return api.field.mock.calls.filter(call => call[0] === '/v1/invoices')
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
    mockField()

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
    expect(invoicePosts()).toHaveLength(1)
    const invoiceBody = JSON.parse(
      (invoicePosts()[0]?.[1] as RequestInit).body as string,
    )
    expect(invoiceBody.billTo).toEqual({ kind: 'customer', customerId: 'cus_1' })
    // Six rounds given up at the default 3,000 each.
    expect(invoiceBody.lineItems[0].unitPrice).toBe(18_000)
    // Both bookings are declared upstream, so Field can answer "has this one
    // already been billed" without CourseBoard's own table (PLT-4158).
    expect(invoiceBody.sources).toEqual([
      { sourceType: 'reservation', sourceId: 'res_1', reason: 'cancellation_fee' },
      { sourceType: 'reservation', sourceId: 'res_2', reason: 'cancellation_fee' },
    ])

    const settle = api.course.mock.calls.find(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )
    expect(settle).toBeTruthy()
    const decisions = JSON.parse((settle?.[1] as RequestInit).body as string).decisions
    expect(decisions).toHaveLength(2)
    expect(decisions.every((decision: { state: string; invoiceId: string }) =>
      decision.state === 'invoiced' && decision.invoiceId === 'inv_1')).toBe(true)
  })

  it('leaves out a booking Field already holds an invoice for, and says so', async () => {
    // Our own row says unsettled — that is why it is on the list. Field says
    // otherwise, which means the invoice went out and the write back failed.
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    mockField([
      { id: 'inv_old', sources: [
        { sourceType: 'reservation', sourceId: 'res_1', reason: 'cancellation_fee' },
      ] },
    ])

    await act(async () => {
      renderPage()
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('この一覧をすべて選ぶ'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    })

    expect(screen.getByText('すでに請求済みの予約があります')).toBeTruthy()
    // Nothing left to bill, so the button cannot raise a second invoice.
    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', true)
  })

  it('says which selected bookings cannot be billed rather than quietly leaving them out', async () => {
    api.course.mockResolvedValue({
      items: [cancellation({ reservationId: 'res_1', customerId: null, billable: false })],
      total: 1,
    })
    mockField()

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

  async function selectAllAndOpenSheet() {
    await act(async () => {
      fireEvent.click(screen.getByLabelText('この一覧をすべて選ぶ'))
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

  function keyOf(index: number) {
    const init = invoicePosts()[index]![1] as RequestInit
    return (JSON.parse(String(init.body)) as { idempotencyKey?: string }).idempotencyKey
  }

  it('bills one person once when the same cancellation comes round twice', async () => {
    // The guard that keeps a booking out of a second batch reads a page of
    // Field's invoices, so it can come back empty while the invoice exists —
    // and the row is offered again. The key used to travel in a header Field
    // never reads, so that second pass raised a second invoice for the same
    // cancellation. Keyed on the charge, it reaches the invoice already there.
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()
    expect(keyOf(0)).toMatch(/^CF-[0-9a-z]+$/)
    // Nothing rides on the header any more.
    expect((invoicePosts()[0]![1] as RequestInit).headers).toBeUndefined()

    await selectAllAndOpenSheet()
    await pressBill()
    expect(invoicePosts()).toHaveLength(2)
    expect(keyOf(1)).toBe(keyOf(0))
  })

  it('gives a changed charge its own key rather than the invoice raised before the change', async () => {
    // A key fixed per person would answer a corrected amount with the invoice
    // the desk was trying to correct.
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()

    await selectAllAndOpenSheet()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('1名あたりの金額', { exact: false }), {
        target: { value: '9000' },
      })
    })
    await pressBill()

    expect(keyOf(1)).not.toBe(keyOf(0))
  })

  it('never records a fee for an invoice that failed to be raised', async () => {
    // The order the whole flow depends on: a row marked invoiced that points at
    // nothing never comes back on the next extraction.
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    api.field.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/invoices?')) return { items: [] }
      throw new Error('field is down')
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /を請求する$/ }))
    })

    expect(api.course.mock.calls.some(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )).toBe(false)
    expect(screen.getByText(/field is down/)).toBeTruthy()
  })
})
