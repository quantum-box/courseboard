import { describe, expect, it } from 'vitest'

import {
  recommendationDetailFacts,
  recommendationSummary,
  type RecommendationForExplanation,
} from './RecommendationExplanation'

function candidate(
  overrides: Partial<RecommendationForExplanation> = {},
): RecommendationForExplanation {
  return {
    skillLevel: 'veteran',
    ratingAverage: 4.6,
    ratingCount: 5,
    roundsAssigned: 1,
    remainingRounds: 2,
    attendanceStatus: 'working',
    recommendationScore: 147,
    pairingDisplayName: null,
    rationale: ['on_duty', 'veteran_for_foursome'],
    ...overrides,
  }
}

describe('recommendation explanation', () => {
  it('summarizes only inputs the current ranker actually uses', () => {
    const summary = recommendationSummary(candidate())

    expect(summary).toContain('評価平均 4.6')
    expect(summary).toContain('勤務中')
    expect(summary).toContain('4人組なのでベテランを優先')
    expect(summary).not.toContain('コース')
    expect(summary).not.toContain('直近')
    expect(summary).not.toContain('147')
    expect(summary).not.toContain('点')
  })

  it('keeps all five inputs available in the detailed explanation', () => {
    expect(recommendationDetailFacts(candidate())).toEqual({
      rating: '平均 4.6（5件）',
      experience: 'ベテラン',
      remaining: 'あと2回',
      attendance: '勤務中',
      composition: '4人組なのでベテランを優先',
    })
  })

  it('describes a missing rating without pretending it was ignored', () => {
    const facts = recommendationDetailFacts(candidate({
      ratingAverage: null,
      ratingCount: 0,
      rationale: ['not_clocked_in', 'no_ratings'],
      attendanceStatus: 'not_clocked',
    }))

    expect(facts.rating).toBe('評価の記録がないため、標準の値で並べています')
    expect(facts.attendance).toBe('まだ出勤していない')
  })

  it('puts an exhausted daily limit in the one-line explanation', () => {
    expect(recommendationSummary(candidate({ remainingRounds: 0 })))
      .toContain('今日はもう担当できません')
  })
})
