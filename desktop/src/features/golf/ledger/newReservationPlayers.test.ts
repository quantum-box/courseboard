import { describe, expect, it } from 'vitest'

import {
  emptyReservationPlayer,
  hasUnnamedReservationPlayer,
  linkedReservationPlayerCount,
  reservationPlayerRows,
  resizeReservationPlayerRows,
  toReservationPlayers,
  type DraftReservationPlayer,
} from './newReservationPlayers'

function row(overrides: Partial<DraftReservationPlayer>): DraftReservationPlayer {
  return { ...emptyReservationPlayer(), ...overrides }
}

describe('new reservation player rows', () => {
  it('starts with one row per booked player', () => {
    expect(reservationPlayerRows(4)).toHaveLength(4)
  })

  it('drops blank rows and trims the values sent to the API', () => {
    expect(toReservationPlayers([
      row({ name: ' 増田 公陽 ', tag: ' 共通 ', memberNumber: ' M-01 ' }),
      emptyReservationPlayer(),
    ])).toEqual([{ name: '増田 公陽', tag: '共通', memberNumber: 'M-01' }])
  })

  it('finds a tag or member number entered without a player name', () => {
    expect(hasUnnamedReservationPlayer([
      row({ name: '  ', tag: '優待' }),
    ])).toBe(true)
  })

  it('does not discard a filled row when headcount is reduced', () => {
    const rows = reservationPlayerRows(4)
    rows[3] = row({ name: '木澤 岳志' })
    expect(resizeReservationPlayerRows(rows, 2)).toHaveLength(4)
  })

  it('removes only blank trailing rows when headcount is reduced', () => {
    expect(resizeReservationPlayerRows(reservationPlayerRows(4), 2)).toHaveLength(2)
  })

  it('sends the ledger identity of a player the desk identified', () => {
    expect(toReservationPlayers([
      row({ name: '本田 康彦', customerId: 'cus_1' }),
    ])).toEqual([{ name: '本田 康彦', customerId: 'cus_1' }])
  })

  it('omits the identity of a player nobody has identified yet', () => {
    // A phone booking yields four names and no identities. That has to save.
    const [player] = toReservationPlayers([row({ name: '増田 公陽' })])
    expect(player).toEqual({ name: '増田 公陽' })
    expect('customerId' in player).toBe(false)
  })

  it('counts how much of the group made it into the ledger', () => {
    expect(linkedReservationPlayerCount([
      row({ name: '本田 康彦', customerId: 'cus_1' }),
      row({ name: '増田 公陽' }),
      // A blank row is a placeholder, not an unidentified player.
      emptyReservationPlayer(),
    ])).toBe(1)
  })
})
