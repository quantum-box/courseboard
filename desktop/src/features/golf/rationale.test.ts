import { describe, expect, it } from 'vitest'
import { readableRationale } from './CaddiesPage'

describe('readableRationale', () => {
  it('rewrites the debug tokens the production API actually returns', () => {
    // Observed verbatim on courseboard.txcloud.app.
    const reasons = readableRationale([
      'rating_count=0',
      'rounds_assigned_today=0',
      'no historical ratings yet; neutral score applied',
    ])

    expect(reasons).toContain('評価の記録なし')
    expect(reasons).toContain('今日の担当 0R')
    expect(reasons.some(reason => reason.includes('rating_count'))).toBe(false)
    expect(reasons.some(reason => reason.includes('rounds_assigned_today'))).toBe(false)
  })

  it('keeps prose it cannot translate rather than inventing a reason', () => {
    const reasons = readableRationale(['veteran preferred for full foursome'])
    expect(reasons).toEqual(['veteran preferred for full foursome'])
  })

  it('unpacks an unknown token instead of dropping it', () => {
    expect(readableRationale(['fairness_index=0.42'])).toEqual(['fairness_index: 0.42'])
  })

  it('passes localized upstream copy through untouched', () => {
    expect(readableRationale(['評価が高い', '午前帯が空いている']))
      .toEqual(['評価が高い', '午前帯が空いている'])
  })

  it('drops blanks and duplicates', () => {
    expect(readableRationale(['  ', 'rating_count=0', 'rating_count=0'])).toEqual(['評価の記録なし'])
  })
})
