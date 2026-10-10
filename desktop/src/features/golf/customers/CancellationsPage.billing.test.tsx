/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, configureApiAuth } from '../../../api'
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
function mockField(
  billedSources: unknown[] = [],
  invoice: Record<string, unknown> = { id: 'inv_1', invoiceNumber: 'INV-1' },
) {
  api.field.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/v1/invoices?')) {
      const offset = Number(new URL(path, 'https://courseboard.test').searchParams.get('offset') ?? 0)
      return { items: billedSources.slice(offset, offset + 100) }
    }
    if (path === '/v1/invoices' && init?.method === 'POST') return invoice
    return {}
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

function configureTestUser(userId: string) {
  configureApiAuth({
    tenantId: 'tenant-cancellations',
    operatorId: 'operator-cancellations',
    platformId: 'platform-cancellations',
    userId,
    getAccessToken: async () => undefined,
    onUnauthorized: () => undefined,
    onForbidden: () => undefined,
  })
}

describe('the cancellation extraction', () => {
  beforeEach(async () => {
    api.course.mockReset()
    api.field.mockReset()
    configureApiAuth(null)
    sessionStorage.clear()
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    configureApiAuth(null)
    sessionStorage.clear()
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
      fireEvent.click(screen.getByLabelText('このページをすべて選ぶ'))
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
      fireEvent.click(screen.getByLabelText('このページをすべて選ぶ'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    })

    expect(screen.getByText('すでに請求済みの予約があります')).toBeTruthy()
    // Nothing left to bill. The source-backed invoice is kept out of the
    // batch; writing it back without a trusted allocation would erase the
    // booking's fee amount.
    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', true)
    expect(api.course.mock.calls.some(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )).toBe(false)
    expect(invoicePosts()).toHaveLength(0)
  })

  it('pages through every source-backed invoice before allowing billing', async () => {
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `inv_old_${index}`,
      sources: [{
        sourceType: 'reservation',
        sourceId: `res_old_${index}`,
        reason: 'cancellation_fee',
      }],
    }))
    mockField([...firstPage, {
      id: 'inv_second_page',
      sources: [{
        sourceType: 'reservation',
        sourceId: 'res_1',
        reason: 'cancellation_fee',
      }],
    }])

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()

    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', true)
    expect(api.field.mock.calls.filter(call => String(call[0]).startsWith('/v1/invoices?')))
      .toHaveLength(2)
  })

  it('revalidates reconciliation after the sheet is reopened', async () => {
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    let billedSources: unknown[] = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/invoices?')) {
        const offset = Number(new URL(path, 'https://courseboard.test').searchParams.get('offset') ?? 0)
        return { items: billedSources.slice(offset, offset + 100) }
      }
      if (path === '/v1/invoices' && init?.method === 'POST') {
        return { id: 'inv_1', invoiceNumber: 'INV-1' }
      }
      return {}
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    })

    billedSources = [{
      id: 'inv_reopened',
      sources: [{ sourceType: 'reservation', sourceId: 'res_1', reason: 'cancellation_fee' }],
    }]
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    })

    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', true)
    expect(invoicePosts()).toHaveLength(0)
  })

  it('bills a booking with no ledger link by the name it was taken under', async () => {
    // The cancellation taken over the phone. It used to be reported as
    // unbillable and dropped, so a club could not collect on any of them.
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

    // The booking is shown as something to decide, not as a failure.
    expect(screen.getByText('台帳と結びついていない予約')).toBeTruthy()
    expect(screen.queryByText('請求できない予約があります')).toBeNull()
    expect(screen.getByText('台帳に無い相手として、この名前で請求します。')).toBeTruthy()

    // The number the desk took over the phone, in the form it was given. An
    // unlinked booking carries no contact details of its own.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('電話番号', { exact: false }), {
        target: { value: '090-0000-0000' },
      })
    })

    await pressBill()

    expect(invoicePosts()).toHaveLength(1)
    const invoiceBody = JSON.parse((invoicePosts()[0]?.[1] as RequestInit).body as string)
    expect(invoiceBody.billTo).toEqual({
      kind: 'unregistered',
      name: '本田 康彦',
      phone: '+819000000000',
    })
    // Two rounds given up at the default 3,000 each, recorded against the
    // booking exactly as a linked one would be.
    expect(invoiceBody.lineItems[0].unitPrice).toBe(6_000)
    const settle = api.course.mock.calls.find(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )
    const decisions = JSON.parse((settle?.[1] as RequestInit).body as string).decisions
    expect(decisions).toEqual([
      { reservationId: 'res_1', state: 'invoiced', invoiceId: 'inv_1', amount: 6_000 },
    ])
  })

  it('omits an unreadable phone from the generic invoice snapshot', async () => {
    api.course.mockResolvedValue({
      items: [cancellation({
        reservationId: 'res_1',
        customerId: null,
        customerPhone: 'not-a-phone',
        billable: false,
        customerEmail: null,
        players: 1,
      })],
      total: 1,
    })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()

    const invoiceBody = JSON.parse((invoicePosts()[0]?.[1] as RequestInit).body as string)
    expect(invoiceBody.billTo).toEqual({ kind: 'unregistered', name: '本田 康彦' })
  })

  it('keeps a partially delivered invoice visible as a failed result', async () => {
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    mockField([], {
      id: 'inv_partial',
      status: 'SendFailed',
      paymentLinkStatus: 'Ready',
      paymentLinkUrl: 'https://pay.example/inv_partial',
      emailDeliveryStatus: 'Failed',
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()

    expect(screen.getByText(/支払いリンクはできましたが/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', true)
  })

  it('waits for a fresh source lookup after reopening before allowing billing', async () => {
    let sourceLookups = 0
    let releaseFreshLookup!: () => void
    const freshLookup = new Promise<void>(resolve => {
      releaseFreshLookup = resolve
    })
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/invoices?')) {
        sourceLookups += 1
        if (sourceLookups === 1) return { items: [] }
        await freshLookup
        return {
          items: [{
            id: 'inv_after_reopen',
            sources: [{ sourceType: 'reservation', sourceId: 'res_1', reason: 'cancellation_fee' }],
          }],
        }
      }
      if (path === '/v1/invoices' && init?.method === 'POST') {
        throw new Error('must not bill before fresh source lookup')
      }
      return {}
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await waitFor(() => expect(sourceLookups).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    await waitFor(() => expect(sourceLookups).toBe(2))

    const bill = screen.getByRole('button', { name: /を請求する$/ })
    expect(bill).toHaveProperty('disabled', true)
    fireEvent.click(bill)
    expect(invoicePosts()).toHaveLength(0)

    releaseFreshLookup()
    await waitFor(() => expect(screen.getByText('すでに請求済みの予約があります')).toBeTruthy())
    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', true)
  })

  it('treats a paid replay as terminal despite stale link and delivery fields', async () => {
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    mockField([], {
      id: 'inv_paid',
      status: 'Paid',
      paymentLinkStatus: 'Failed',
      paymentLinkUrl: null,
      emailDeliveryStatus: 'Failed',
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()

    expect(screen.queryByText(/支払いリンクはできましたが/)).toBeNull()
    const settle = api.course.mock.calls.find(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )
    expect(settle).toBeTruthy()
    const decisions = JSON.parse((settle?.[1] as RequestInit).body as string).decisions
    expect(decisions).toEqual([
      { reservationId: 'res_1', state: 'invoiced', invoiceId: 'inv_paid', amount: 12_000 },
    ])
  })

  it('bills the ledger customer the desk recognised for an unlinked booking', async () => {
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

    // The box opens holding the name the booking was taken under, so landing
    // in it asks the ledger who that is. Nothing is picked automatically: two
    // members called 本田 are one row apart in the list.
    await act(async () => {
      // `focusIn`, not `focus`: React listens for the bubbling one.
      fireEvent.focusIn(screen.getByLabelText('請求先の名前', { exact: false }))
    })
    // Awaited outside `act`: the search is debounced, and a `findBy` nested in
    // an `act` never sees the timer fire.
    const candidate = await screen.findByRole('button', { name: /本田 康彦/ })
    await act(async () => {
      fireEvent.click(candidate)
    })
    await pressBill()

    const invoiceBody = JSON.parse((invoicePosts()[0]?.[1] as RequestInit).body as string)
    expect(invoiceBody.billTo).toEqual({ kind: 'customer', customerId: 'cus_9' })
  })

  it('says which selected bookings cannot be billed rather than quietly leaving them out', async () => {
    // Nothing to address an invoice to: no ledger link and no name on the
    // booking either. The name box is there, and until it is filled in the
    // sheet says why this row is not on the bill.
    api.course.mockResolvedValue({
      items: [cancellation({
        reservationId: 'res_1',
        customerId: null,
        customerName: null,
        billable: false,
      })],
      total: 1,
    })
    mockField()

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()

    expect(screen.getByText('請求できない予約があります')).toBeTruthy()
    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', true)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('請求先の名前', { exact: false }), {
        target: { value: '名前のわかった人' },
      })
    })

    expect(screen.queryByText('請求できない予約があります')).toBeNull()
    expect(screen.getByRole('button', { name: /を請求する$/ })).toHaveProperty('disabled', false)
  })

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

  it('freezes amount and due date after Field succeeds but settlement write-back fails', async () => {
    let settlementAttempts = 0
    api.course.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/course/reservation-cancellations?')) {
        return { items: [cancellation()], total: 1 }
      }
      if (path === '/v1/course/reservation-cancellations/fees' && init?.method === 'POST') {
        settlementAttempts += 1
        if (settlementAttempts === 1) throw new Error('write-back failed')
        return {}
      }
      return {}
    })
    let fieldCreateRequests = 0
    const fieldCreateKeys: string[] = []
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/invoices?')) return { items: [] }
      if (path === '/v1/invoices' && init?.method === 'POST') {
        fieldCreateRequests += 1
        const body = JSON.parse(String(init.body)) as { idempotencyKey: string }
        fieldCreateKeys.push(body.idempotencyKey)
        return { id: 'inv_frozen', invoiceNumber: 'INV-FROZEN' }
      }
      return {}
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()

    const amount = screen.getByLabelText('1名あたりの金額', { exact: false }) as HTMLInputElement
    const dueDate = screen.getByLabelText('支払期日') as HTMLInputElement
    expect(amount.disabled).toBe(true)
    expect(dueDate.disabled).toBe(true)
    const first = JSON.parse(String((invoicePosts()[0]![1] as RequestInit).body))

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /12,000.*を請求する/ })).toBeTruthy())
    expect(screen.getByText(new RegExp(first.dueDate))).toBeTruthy()
    const reopenedAmount = screen.getByLabelText('1名あたりの金額', { exact: false }) as HTMLInputElement
    const reopenedDueDate = screen.getByLabelText('支払期日') as HTMLInputElement
    expect(reopenedAmount).toHaveProperty('disabled', true)
    expect(reopenedDueDate).toHaveProperty('disabled', true)

    fireEvent.change(reopenedAmount, { target: { value: '9000' } })
    fireEvent.change(reopenedDueDate, { target: { value: '2099-01-01' } })
    await pressBill()

    expect(fieldCreateRequests).toBe(2)
    // The second HTTP request is a safe idempotent replay, not a new charge.
    expect(new Set(fieldCreateKeys)).toHaveLength(1)
    expect(settlementAttempts).toBe(2)
    const posts = invoicePosts()
    const second = JSON.parse(String((posts[1]![1] as RequestInit).body))
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(second.lineItems[0].unitPrice).toBe(first.lineItems[0].unitPrice)
    expect(second.dueDate).toBe(first.dueDate)
  })

  it('keeps a recovery in the opening user scope when auth changes mid-batch', async () => {
    configureTestUser('user-a')
    api.course.mockResolvedValue({
      items: [
        cancellation({ reservationId: 'res_1' }),
        cancellation({
          reservationId: 'res_2',
          customerId: 'cus_2',
          customerName: '佐藤 花子',
          customerEmail: 'sato@example.com',
        }),
      ],
      total: 2,
    })
    let releaseFieldCreate!: () => void
    const fieldCreateStarted = new Promise<void>(resolve => {
      api.field.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path.startsWith('/v1/invoices?')) return { items: [] }
        if (path === '/v1/invoices' && init?.method === 'POST') {
          resolve()
          await new Promise<void>(resolveRequest => {
            releaseFieldCreate = resolveRequest
          })
          return { id: 'inv_scope' }
        }
        return {}
      })
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    const pending = pressBill()
    await fieldCreateStarted
    configureTestUser('user-b')
    releaseFieldCreate()
    await pending

    expect(api.course.mock.calls.some(
      call => (call[0] as string) === '/v1/course/reservation-cancellations/fees',
    )).toBe(false)
    expect(Object.keys(sessionStorage).some(key => key.includes('tenant-cancellations')
      && key.includes('user-a'))).toBe(true)
    expect(Object.keys(sessionStorage).some(key => key.includes('user-b'))).toBe(false)
  })

  it('blocks a subset batch while the original multi-source create is unresolved', async () => {
    let sourceLookups = 0
    let createAttempts = 0
    api.course.mockResolvedValue({
      items: [
        cancellation({ reservationId: 'res_1' }),
        cancellation({ reservationId: 'res_2' }),
      ],
      total: 2,
    })
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/invoices?')) {
        sourceLookups += 1
        return { items: [] }
      }
      if (path === '/v1/invoices' && init?.method === 'POST') {
        createAttempts += 1
        throw new Error('Field response lost')
      }
      return {}
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()
    expect(createAttempts).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    const rowChecks = screen.getAllByRole('checkbox')
    // Filter toggle, page toggle, then the two row toggles.
    fireEvent.click(rowChecks[2]!)
    fireEvent.click(screen.getByRole('button', { name: /キャンセル料を請求/ }))
    await waitFor(() => expect(sourceLookups).toBe(2))

    const bill = screen.getByRole('button', { name: /を請求する$/ })
    expect(bill).toHaveProperty('disabled', true)
    fireEvent.click(bill)
    expect(createAttempts).toBe(1)
  })

  it('keeps the original recovery after an authentication failure on replay', async () => {
    let createAttempts = 0
    api.course.mockResolvedValue({ items: [cancellation()], total: 1 })
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/invoices?')) return { items: [] }
      if (path === '/v1/invoices' && init?.method === 'POST') {
        createAttempts += 1
        if (createAttempts === 1) throw new Error('Field response lost')
        if (createAttempts === 2) throw new ApiError('session changed', 401)
        return { id: 'inv_replay' }
      }
      return {}
    })

    await act(async () => {
      renderPage()
    })
    await selectAllAndOpenSheet()
    await pressBill()
    const first = JSON.parse(String((invoicePosts()[0]![1] as RequestInit).body))

    await pressBill()
    const secondInput = screen.getByLabelText('1名あたりの金額', { exact: false }) as HTMLInputElement
    expect(secondInput).toHaveProperty('disabled', true)
    fireEvent.change(secondInput, { target: { value: '9000' } })
    await pressBill()

    expect(createAttempts).toBe(3)
    const third = JSON.parse(String((invoicePosts()[2]![1] as RequestInit).body))
    expect(third.idempotencyKey).toBe(first.idempotencyKey)
    expect(third.lineItems[0].unitPrice).toBe(first.lineItems[0].unitPrice)
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
      fireEvent.click(screen.getByLabelText('このページをすべて選ぶ'))
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
