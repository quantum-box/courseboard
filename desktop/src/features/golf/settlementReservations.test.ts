import { describe, expect, it } from 'vitest'

import { settlementReservationRows } from './SettlementPage'

describe('settlementReservationRows', () => {
  it('keeps only bookings in the monthly total and orders readable rows by tee time', () => {
    const rows = settlementReservationRows(
      ['rsv_late', 'rsv_early'],
      [
        { reservationId: 'rsv_other', teeTime: '2026-08-01T06:00:00+09:00' },
        { reservationId: 'rsv_late', teeTime: '2026-08-09T09:00:00+09:00' },
        { reservationId: 'rsv_early', teeTime: '2026-08-09T07:00:00+09:00' },
      ],
    )

    expect(rows.map(row => row.reservationId)).toEqual(['rsv_early', 'rsv_late'])
  })

  it('keeps a traceable fallback when one booking cannot be resolved', () => {
    const rows = settlementReservationRows(
      ['rsv_found', 'rsv_missing'],
      [{ reservationId: 'rsv_found', customerName: '山田 太郎', teeTime: '2026-08-09T07:00:00+09:00' }],
    )

    expect(rows).toEqual([
      { reservationId: 'rsv_found', customerName: '山田 太郎', teeTime: '2026-08-09T07:00:00+09:00' },
      { reservationId: 'rsv_missing' },
    ])
  })
})
