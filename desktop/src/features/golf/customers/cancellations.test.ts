import { describe, expect, it } from 'vitest'

import {
  addDays,
  CANCELLATION_PAGE_SIZE,
  cancellationSortForColumn,
  cancellationsQuery,
  defaultCancellationFilters,
  planCancellationFees,
  splitFeeAcrossRows,
  type ReservationCancellation,
} from './cancellations'

function row(overrides: Partial<ReservationCancellation> = {}): ReservationCancellation {
  return {
    reservationId: 'res_1',
    customerId: 'cus_1',
    customerName: '本田 康彦',
    billable: true,
    players: 4,
    reason: 'personal',
    feeExpected: true,
    feeState: 'unsettled',
    cancelledAt: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

describe('the collection list the desk opens on', () => {
  it('asks for the last month of chargeable cancellations nobody has settled', () => {
    const filters = defaultCancellationFilters('2026-06-30')
    expect(filters.from).toBe('2026-05-31')
    expect(filters.to).toBe('2026-06-30')
    expect(filters.feeState).toBe('unsettled')
    expect(filters.chargeableOnly).toBe(true)

    const query = cancellationsQuery(filters)
    expect(query).toContain('from=2026-05-31')
    expect(query).toContain('feeStates=unsettled')
    expect(query).toContain('feeExpectedOnly=true')
    expect(query).toContain(`limit=${CANCELLATION_PAGE_SIZE}`)
    expect(query).not.toContain('offset')
    expect(query).not.toContain('sort=')
  })

  it('asks the server to order and page the whole period', () => {
    const query = cancellationsQuery(
      defaultCancellationFilters('2026-06-30'),
      { sort: 'booking_amount', ascending: true },
      3,
    )
    expect(query).toContain('sort=booking_amount')
    expect(query).toContain('ascending=true')
    expect(query).toContain(`offset=${CANCELLATION_PAGE_SIZE * 3}`)
    expect(cancellationSortForColumn('bookingAmount')).toBe('booking_amount')
    expect(cancellationSortForColumn('name')).toBeNull()
  })

  it('drops the chargeable-only narrowing once one reason is named', () => {
    // Asking for weather by name and getting nothing back would look like a
    // month with no weather cancellations in it.
    const query = cancellationsQuery({
      from: '2026-06-01',
      to: '2026-06-30',
      reason: 'weather',
      feeState: '',
      chargeableOnly: true,
    })
    expect(query).toContain('reasons=weather')
    expect(query).not.toContain('feeExpectedOnly')
  })

  it('counts days across a month boundary', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('what a bulk collection would send', () => {
  it('bills one person once for everything they cancelled', () => {
    const plan = planCancellationFees(
      [
        row({ reservationId: 'res_1', players: 4 }),
        row({ reservationId: 'res_2', players: 2 }),
      ],
      3_000,
    )

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.rows).toHaveLength(2)
    expect(plan.groups[0]?.players).toBe(6)
    expect(plan.groups[0]?.amount).toBe(18_000)
    expect(plan.total).toBe(18_000)
  })

  it('keeps people apart', () => {
    const plan = planCancellationFees(
      [
        row({ reservationId: 'res_1', customerId: 'cus_1', players: 1 }),
        row({ reservationId: 'res_2', customerId: 'cus_2', players: 1 }),
      ],
      5_000,
    )

    expect(plan.groups).toHaveLength(2)
    expect(plan.total).toBe(10_000)
  })

  it('bills a booking nobody linked by the name it was taken under', () => {
    // The ordinary cancellation taken over the phone. Requiring a customer id
    // for it left every one of them uncollectable, and leaving it out of the
    // batch billed less than the desk selected while saying nothing about it.
    const plan = planCancellationFees(
      [row({ reservationId: 'res_1', customerId: null, billable: false, players: 2 })],
      5_000,
    )

    expect(plan.unbillable).toHaveLength(0)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.recipient).toEqual({ kind: 'unregistered', name: '本田 康彦' })
    expect(plan.total).toBe(10_000)
  })

  it('keeps two unlinked bookings apart even under the same name', () => {
    // Two people called 本田 cancelling in the same month is ordinary, and a
    // typed name is not evidence that they are one person. One invoice for
    // both would put one guest's fee on the other guest's bill.
    const plan = planCancellationFees(
      [
        row({ reservationId: 'res_1', customerId: null, players: 1 }),
        row({ reservationId: 'res_2', customerId: null, players: 1 }),
      ],
      5_000,
    )

    expect(plan.groups.map(group => group.key)).toEqual([
      'reservation:res_1',
      'reservation:res_2',
    ])
    expect(plan.total).toBe(10_000)
  })

  it('reports a booking with no name at all rather than inventing a recipient', () => {
    const plan = planCancellationFees(
      [row({ reservationId: 'res_1', customerId: null, customerName: null })],
      5_000,
    )

    expect(plan.groups).toHaveLength(0)
    expect(plan.unbillable).toHaveLength(1)
    expect(plan.unbillable[0]?.reason).toBe('unnamed')
    expect(plan.unbillable[0]?.row.reservationId).toBe('res_1')
    expect(plan.total).toBe(0)
  })

  it('takes the name and number the desk typed for an unlinked booking', () => {
    const plan = planCancellationFees(
      [row({ reservationId: 'res_1', customerId: null, customerName: '本田', players: 1 })],
      5_000,
      new Set(),
      new Map([['res_1', { customer: null, name: '新谷 花子', phone: '+819000000000' }]]),
    )

    expect(plan.groups[0]?.recipient).toEqual({
      kind: 'unregistered',
      name: '新谷 花子',
      phone: '+819000000000',
    })
    expect(plan.groups[0]?.customerName).toBe('新谷 花子')
  })

  it('merges an unlinked booking into the ledger customer the desk recognised', () => {
    // Somebody with one linked cancellation and one unlinked gets a single
    // invoice, which is the whole reason the groups exist.
    const plan = planCancellationFees(
      [
        row({ reservationId: 'res_1', customerId: 'cus_1', players: 1 }),
        row({ reservationId: 'res_2', customerId: null, customerName: '本田', players: 1 }),
      ],
      5_000,
      new Set(),
      new Map([[
        'res_2',
        { customer: { id: 'cus_1', name: '本田 康彦' }, name: '本田 康彦' },
      ]]),
    )

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.recipient).toEqual({ kind: 'customer', customerId: 'cus_1' })
    expect(plan.groups[0]?.rows.map(entry => entry.reservationId)).toEqual(['res_1', 'res_2'])
    expect(plan.total).toBe(10_000)
  })

  it('leaves out a booking Field already holds an invoice for', () => {
    // Our own row says unsettled, which is why the desk selected it. Field
    // says otherwise, which means the invoice went out and the write back
    // failed. Billing it again is the double charge this guard exists for.
    const plan = planCancellationFees(
      [row({ reservationId: 'res_1' }), row({ reservationId: 'res_2' })],
      3_000,
      new Set(['res_1']),
    )

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.rows.map(entry => entry.reservationId)).toEqual(['res_2'])
    expect(plan.unbillable).toHaveLength(1)
    expect(plan.unbillable[0]?.reason).toBe('already_invoiced')
  })

  it('bills the whole batch when the upstream check could not be made', () => {
    // An empty set is "we do not know", not "nothing is billed". Blocking the
    // batch on a failed read would stop the desk on a morning Field is slow.
    const plan = planCancellationFees([row()], 3_000)
    expect(plan.groups).toHaveLength(1)
    expect(plan.unbillable).toHaveLength(0)
  })

  it('charges a booking with no headcount as one round rather than as nothing', () => {
    const plan = planCancellationFees([row({ players: 0 })], 5_000)
    expect(plan.groups[0]?.amount).toBe(5_000)
  })

  it('finds a contact for the group from whichever booking carries one', () => {
    const plan = planCancellationFees(
      [
        row({ reservationId: 'res_1', customerEmail: null }),
        row({ reservationId: 'res_2', customerEmail: 'guest@example.com' }),
      ],
      3_000,
    )
    expect(plan.groups[0]?.customerEmail).toBe('guest@example.com')
  })
})

describe('attributing an invoice back to the bookings it covers', () => {
  it('splits by rounds given up, not evenly', () => {
    const plan = planCancellationFees(
      [
        row({ reservationId: 'res_1', players: 4 }),
        row({ reservationId: 'res_2', players: 2 }),
      ],
      3_000,
    )
    const shares = splitFeeAcrossRows(plan.groups[0]!)

    expect(shares).toEqual([
      { reservationId: 'res_1', amount: 12_000 },
      { reservationId: 'res_2', amount: 6_000 },
    ])
  })

  it('always adds back up to the invoice, remainder and all', () => {
    // A set of rows that sums to a different number than the bill is the kind
    // of discrepancy nobody finds until an auditor does.
    const plan = planCancellationFees(
      [
        row({ reservationId: 'res_1', players: 1 }),
        row({ reservationId: 'res_2', players: 1 }),
        row({ reservationId: 'res_3', players: 1 }),
      ],
      3_334,
    )
    const shares = splitFeeAcrossRows(plan.groups[0]!)

    expect(shares.reduce((sum, share) => sum + share.amount, 0))
      .toBe(plan.groups[0]!.amount)
  })
})
