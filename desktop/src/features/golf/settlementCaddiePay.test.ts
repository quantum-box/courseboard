import { describe, expect, it } from 'vitest'
import type { PayrollRow, Rank } from './caddieRankFees'
import { settlementCaddiePay } from './settlementCaddiePay'

function row(overrides: Partial<PayrollRow> & { rank: Rank }): PayrollRow {
  return {
    caddieProfileId: `cad_${overrides.rank}`,
    displayName: overrides.rank,
    workedMinutes: 0,
    shiftedMinutes: 0,
    assignedRounds: 0,
    roundFee: 0,
    feeOverridden: false,
    feeTotal: 0,
    currency: 'JPY',
    openClockIn: false,
    roundsWithoutClockIn: 0,
    ...overrides,
  }
}

describe('caddie pay on the monthly close', () => {
  it('adds up the pay the rows already priced and shows the gap to what was committed', () => {
    const pay = settlementCaddiePay(
      [
        row({ rank: 'A', assignedRounds: 2, feeTotal: 24000 }),
        row({ rank: 'B', caddieProfileId: 'b1', assignedRounds: 1, feeTotal: 13000 }),
        row({ rank: 'D', caddieProfileId: 'd1' }),
      ],
      // B was 11,000 when the round was assigned and has since been corrected.
      { total: 35000, currency: 'JPY' },
    )
    expect(pay).toMatchObject({
      currency: 'JPY',
      fees: 37000,
      rounds: 3,
      caddiesOnRounds: 2,
      committed: 35000,
      difference: 2000,
    })
    expect(pay.byRank.map(item => item.rank)).toEqual(['A', 'B', 'C', 'D'])
    expect(pay.byRank[3]).toMatchObject({ caddies: 1, rounds: 0, fees: 0 })
  })

  it('counts caddies to check, not the individual days', () => {
    const pay = settlementCaddiePay(
      [
        row({ rank: 'A', openClockIn: true, roundsWithoutClockIn: 2 }),
        row({ rank: 'C', caddieProfileId: 'c1', roundsWithoutClockIn: 1 }),
        row({ rank: 'C', caddieProfileId: 'c2' }),
      ],
      { total: 0, currency: 'JPY' },
    )
    expect(pay.caddiesToCheck).toBe(2)
  })

  it('does not subtract amounts in different currencies', () => {
    const pay = settlementCaddiePay(
      [row({ rank: 'A', assignedRounds: 1, feeTotal: 100, currency: 'USD' })],
      { total: 12000, currency: 'JPY' },
    )
    expect(pay.currency).toBe('USD')
    expect(pay.difference).toBeNull()
  })

  it('reads an empty roster in the close currency with no gap', () => {
    const pay = settlementCaddiePay([], { total: 0, currency: 'JPY' })
    expect(pay).toMatchObject({ currency: 'JPY', fees: 0, difference: 0, caddiesToCheck: 0 })
  })
})
