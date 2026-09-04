import { describe, expect, it } from 'vitest'

import {
  addDays,
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

  it('reports a booking nobody linked instead of quietly dropping it', () => {
    // Silently leaving it out would bill less than the desk selected and say
    // nothing about it, which is money nobody chases.
    const plan = planCancellationFees(
      [row({ reservationId: 'res_1', customerId: null, billable: false })],
      5_000,
    )

    expect(plan.groups).toHaveLength(0)
    expect(plan.unbillable).toHaveLength(1)
    expect(plan.unbillable[0]?.row.reservationId).toBe('res_1')
    expect(plan.total).toBe(0)
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
