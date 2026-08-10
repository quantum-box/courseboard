import { describe, expect, it } from 'vitest'

import {
  emptyReservationPlayer,
  hasUnnamedReservationPlayer,
  reservationPlayerRows,
  resizeReservationPlayerRows,
  toReservationPlayers,
} from './newReservationPlayers'

describe('new reservation player rows', () => {
  it('starts with one row per booked player', () => {
    expect(reservationPlayerRows(4)).toHaveLength(4)
  })

  it('drops blank rows and trims the values sent to the API', () => {
    expect(toReservationPlayers([
      { name: ' 増田 公陽 ', tag: ' 共通 ', memberNumber: ' M-01 ' },
      emptyReservationPlayer(),
    ])).toEqual([{ name: '増田 公陽', tag: '共通', memberNumber: 'M-01' }])
  })

  it('finds a tag or member number entered without a player name', () => {
    expect(hasUnnamedReservationPlayer([
      { name: '  ', tag: '優待', memberNumber: '' },
    ])).toBe(true)
  })

  it('does not discard a filled row when headcount is reduced', () => {
    const rows = reservationPlayerRows(4)
    rows[3] = { name: '木澤 岳志', tag: '', memberNumber: '' }
    expect(resizeReservationPlayerRows(rows, 2)).toHaveLength(4)
  })

  it('removes only blank trailing rows when headcount is reduced', () => {
    expect(resizeReservationPlayerRows(reservationPlayerRows(4), 2)).toHaveLength(2)
  })
})
