import { courseboardApiJson } from '../../api'
import { isMockFieldDataEnabled } from '../../dev/mockFieldApi'
import type { InsightReservation, Period } from './datasets'
import { SAMPLE_WEEKDAY_LAYOUT } from './sampleLayout'

export type LayoutAnswer = {
  text: string
  model: string
  /** True when no model was asked: the mock desk shows a canned layout. */
  sample: boolean
}

export async function fetchReservations(period: Period): Promise<InsightReservation[]> {
  const query = new URLSearchParams({ date: period.from, to: period.to })
  const response = await courseboardApiJson<{ items: InsightReservation[] }>(`/v1/course/tee-sheet?${query}`)
  return response.items ?? []
}

export async function requestLayout(system: string, question: string): Promise<LayoutAnswer> {
  // The mock desk has no backend to hold an API key; it shows what a real
  // answer to the PoC's first question looks like, bound to the mock data.
  if (isMockFieldDataEnabled()) {
    return { text: SAMPLE_WEEKDAY_LAYOUT, model: 'sample', sample: true }
  }
  const answer = await courseboardApiJson<{ text: string; model: string }>('/v1/course/insights/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, question }),
  })
  return { ...answer, sample: false }
}
