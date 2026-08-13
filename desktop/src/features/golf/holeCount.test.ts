import { describe, expect, it } from 'vitest'

import { holeCountOptions } from './holeCount'

describe('holeCountOptions', () => {
  it('offers the usual two when the record uses one of them', () => {
    expect(holeCountOptions(18)).toEqual([18, 9])
    expect(holeCountOptions(9)).toEqual([18, 9])
  })

  it('offers whatever the record already says, so the form opens on it', () => {
    // A 27 hole course used to open showing "18", and saving wrote 18 back.
    expect(holeCountOptions(27)).toEqual([27, 18, 9])
    expect(holeCountOptions(36)).toEqual([36, 18, 9])
    expect(holeCountOptions(6)).toEqual([18, 9, 6])
  })

  it('leaves out a value nobody should be able to save', () => {
    expect(holeCountOptions(null)).toEqual([18, 9])
    expect(holeCountOptions(undefined)).toEqual([18, 9])
    expect(holeCountOptions(0)).toEqual([18, 9])
    expect(holeCountOptions(-9)).toEqual([18, 9])
    expect(holeCountOptions(13.5)).toEqual([18, 9])
    expect(holeCountOptions(Number.NaN)).toEqual([18, 9])
  })
})
