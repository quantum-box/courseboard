import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RANK_FEES,
  buildRankFees,
  payrollTotals,
  rankFeeDraft,
  rankFeeDraftIsDirty,
  rankTotals,
  type PayrollRow,
  type Rank,
} from './caddieRankFees'

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

describe('rank fee draft', () => {
  it('starts from the amounts the club is paying by', () => {
    expect(rankFeeDraft(DEFAULT_RANK_FEES)).toEqual({
      A: '12000',
      B: '11000',
      C: '10000',
      D: '9000',
    })
  })

  it('is not dirty until an amount actually changes', () => {
    const draft = rankFeeDraft(DEFAULT_RANK_FEES)
    expect(rankFeeDraftIsDirty(draft, DEFAULT_RANK_FEES)).toBe(false)
    expect(rankFeeDraftIsDirty({ ...draft, B: '11500' }, DEFAULT_RANK_FEES)).toBe(true)
  })

  it('keeps the currency it was given', () => {
    expect(buildRankFees(rankFeeDraft(DEFAULT_RANK_FEES), 'JPY').currency).toBe('JPY')
  })

  it('refuses a cleared amount instead of paying zero for that rank', () => {
    const draft = { ...rankFeeDraft(DEFAULT_RANK_FEES), C: '' }
    expect(() => buildRankFees(draft, 'JPY')).toThrow()
  })

  it('refuses amounts the API would reject anyway', () => {
    const base = rankFeeDraft(DEFAULT_RANK_FEES)
    expect(() => buildRankFees({ ...base, A: '-1' }, 'JPY')).toThrow()
    expect(() => buildRankFees({ ...base, A: '12000.5' }, 'JPY')).toThrow()
    expect(() => buildRankFees({ ...base, A: '9999999' }, 'JPY')).toThrow()
  })

  it('accepts a rank the club has decided not to pay for', () => {
    const draft = { ...rankFeeDraft(DEFAULT_RANK_FEES), D: '0' }
    expect(buildRankFees(draft, 'JPY').d).toBe(0)
  })
})

describe('rank breakdown', () => {
  it('gives every rank a line, including the ones nobody holds', () => {
    const totals = rankTotals([row({ rank: 'A', assignedRounds: 2, feeTotal: 24000 })])
    expect(totals.map(item => item.rank)).toEqual(['A', 'B', 'C', 'D'])
    expect(totals[1]).toMatchObject({ rank: 'B', caddies: 0, rounds: 0, fees: 0 })
  })

  it('adds up rounds and pay within a rank', () => {
    const totals = rankTotals([
      row({ rank: 'B', caddieProfileId: 'b1', assignedRounds: 3, feeTotal: 33000 }),
      row({ rank: 'B', caddieProfileId: 'b2', assignedRounds: 1, feeTotal: 11000 }),
    ])
    expect(totals[1]).toMatchObject({ caddies: 2, rounds: 4, fees: 44000 })
  })

  it('counts the caddies whose pay does not come from their rank', () => {
    const totals = rankTotals([
      row({ rank: 'D', caddieProfileId: 'd1', feeOverridden: true }),
      row({ rank: 'D', caddieProfileId: 'd2' }),
    ])
    expect(totals[3]).toMatchObject({ caddies: 2, overridden: 1 })
  })
})

describe('month totals', () => {
  it('counts an unclosed shift and a missing clock-in as things to check', () => {
    const totals = payrollTotals([
      row({ rank: 'A', openClockIn: true }),
      row({ rank: 'C', caddieProfileId: 'c1', roundsWithoutClockIn: 2 }),
    ])
    expect(totals.warnings).toBe(3)
  })

  it('sums the pay the rows already priced', () => {
    const totals = payrollTotals([
      row({ rank: 'A', assignedRounds: 2, feeTotal: 24000, workedMinutes: 600 }),
      row({ rank: 'D', caddieProfileId: 'd1', assignedRounds: 1, feeTotal: 9000 }),
    ])
    expect(totals).toEqual({ workedMinutes: 600, rounds: 3, fees: 33000, warnings: 0 })
  })
})
