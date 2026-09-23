import { describe, expect, it } from 'vitest'

import { unregisteredNames } from './unregisteredNames'
import type { DraftReservationPlayer } from './newReservationPlayers'

function player(overrides: Partial<DraftReservationPlayer> = {}): DraftReservationPlayer {
  return { name: '', tag: '', memberNumber: '', customerId: null, ...overrides }
}

describe('unregisteredNames', () => {
  it('asks about a booker the desk typed without picking anyone', () => {
    const found = unregisteredNames({ name: '本田 康彦', customerId: null }, [])
    expect(found).toEqual([{ name: '本田 康彦', role: 'booker' }])
  })

  it('says nothing about someone already picked from the ledger', () => {
    const found = unregisteredNames({ name: '本田 康彦', customerId: 'cus_1' }, [
      player({ name: '増田 公陽', customerId: 'cus_2' }),
    ])
    expect(found).toEqual([])
  })

  it('asks once about the booker who is also playing', () => {
    // The desk types the booker's name in both places. Asking twice would
    // register them twice, which is the duplicate the ledger exists to avoid.
    const found = unregisteredNames({ name: '本田 康彦', customerId: null }, [
      player({ name: '本田 康彦' }),
      player({ name: '増田 公陽' }),
    ])
    expect(found).toEqual([
      { name: '本田 康彦', role: 'booker' },
      { name: '増田 公陽', role: 'player', playerIndex: 1 },
    ])
  })

  it('ignores empty seats, which are seats rather than people', () => {
    const found = unregisteredNames({ name: '', customerId: null }, [
      player({ name: '  ' }),
      player(),
    ])
    expect(found).toEqual([])
  })

  it('keeps the roster position so the answer can be written back', () => {
    const found = unregisteredNames({ name: '本田 康彦', customerId: 'cus_1' }, [
      player({ name: '増田 公陽', customerId: 'cus_2' }),
      player({ name: '辻 俊行' }),
    ])
    expect(found).toEqual([{ name: '辻 俊行', role: 'player', playerIndex: 1 }])
  })

  it('trims what the desk typed so a stray space is not a different person', () => {
    const found = unregisteredNames({ name: ' 本田 康彦 ', customerId: null }, [
      player({ name: '本田 康彦' }),
    ])
    expect(found).toEqual([{ name: '本田 康彦', role: 'booker' }])
  })
})
