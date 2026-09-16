import { describe, expect, it } from 'vitest'
import {
  alignmentRequest,
  canAlign,
  initialSelection,
  selectedCuts,
  summarizeResults,
  type FeeAlignmentCandidate,
} from './caddieFeeAlignment'

function candidate(
  id: string,
  ownFee: number,
  rankFee: number,
): FeeAlignmentCandidate {
  const difference = rankFee - ownFee
  return {
    caddieProfileId: id,
    displayName: id,
    active: true,
    rank: 'B',
    ownFee,
    rankFee,
    difference,
    effect: difference === 0 ? 'unchanged' : difference > 0 ? 'raise' : 'cut',
  }
}

describe('caddie fee alignment', () => {
  const same = candidate('same', 11_000, 11_000)
  const raise = candidate('raise', 10_000, 11_000)
  const cut = candidate('cut', 13_000, 11_000)
  const unpriced = candidate('unpriced', 9_000, 0)

  it('starts with only the moves that change nobody’s pay ticked', () => {
    expect([...initialSelection([same, raise, cut])]).toEqual(['same'])
  })

  it('never offers a move onto a rank priced at zero', () => {
    expect(canAlign(unpriced)).toBe(false)
    expect(initialSelection([candidate('zero', 0, 0), unpriced]).size).toBe(0)
  })

  it('sends the fee each caddie showed, and only the ticked ones', () => {
    const body = alignmentRequest([same, cut, unpriced], new Set(['cut', 'unpriced']), '  9/1 現場合意 ')
    expect(body).toEqual({
      items: [{ caddieProfileId: 'cut', expectedOwnFee: 13_000 }],
      note: '9/1 現場合意',
    })
  })

  it('leaves a blank reason out rather than sending an empty one', () => {
    expect(alignmentRequest([same], new Set(['same']), '   ')).toEqual({
      items: [{ caddieProfileId: 'same', expectedOwnFee: 11_000 }],
    })
  })

  it('totals the pay cuts among the ticked moves', () => {
    expect(selectedCuts([same, raise, cut], new Set(['same', 'cut']))).toEqual({
      count: 1,
      perRound: -2_000,
    })
  })

  it('counts who moved and who did not', () => {
    expect(summarizeResults([
      { caddieProfileId: 'a', outcome: 'aligned' },
      { caddieProfileId: 'b', outcome: 'own_fee_changed' },
      { caddieProfileId: 'c', outcome: 'failed', message: 'x' },
    ])).toEqual({ aligned: 1, skipped: 2 })
  })
})
