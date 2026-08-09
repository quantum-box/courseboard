import { i18next } from '../../i18n'

export type RecommendationAttendanceStatus =
  | 'working'
  | 'not_clocked'
  | 'clocked_out'
  | 'not_linked'

export type RecommendationForExplanation = {
  skillLevel: string
  ratingAverage?: number | null
  ratingCount: number
  roundsAssigned: number
  remainingRounds?: number | null
  attendanceStatus?: RecommendationAttendanceStatus | null
  recommendationScore: number
  pairingDisplayName?: string | null
  rationale: string[]
}

function t(key: string, values?: Record<string, string>) {
  return i18next.t(
    `caddies:recommendations.explanation.${key}` as 'caddies:recommendations.explanation.open',
    values,
  )
}

function skill(item: RecommendationForExplanation) {
  const known = ['rookie', 'regular', 'veteran'].includes(item.skillLevel)
    ? item.skillLevel
    : 'regular'
  return i18next.t(`caddies:skill.${known}` as 'caddies:skill.regular')
}

function attendance(status?: RecommendationAttendanceStatus | null) {
  if (!status) return t('unknown')
  return i18next.t(
    `caddies:attendanceStatus.${status}` as 'caddies:attendanceStatus.not_clocked',
  )
}

function includesReason(item: RecommendationForExplanation, reason: string) {
  return item.rationale.some(entry => entry.trim() === reason)
}

function composition(item: RecommendationForExplanation) {
  if (includesReason(item, 'rookie_paired_with_veteran')) {
    return item.pairingDisplayName
      ? t('rookiePair', { name: item.pairingDisplayName })
      : t('rookiePairUnknown')
  }
  if (includesReason(item, 'veteran_for_foursome')) return t('veteranFoursome')
  return t('compositionNone')
}

/** Short, factual reasons shown beside the rank. Never invents a score input. */
export function recommendationSummary(
  item: RecommendationForExplanation,
  attendanceFallback?: RecommendationAttendanceStatus,
) {
  const status = item.attendanceStatus ?? attendanceFallback
  const atLimit = item.remainingRounds === 0
  const facts: Array<string | null> = [
    atLimit ? t('remainingNoneShort') : null,
    item.ratingAverage == null
      ? t('ratingNoneShort')
      : t('ratingShort', { value: item.ratingAverage.toFixed(1) }),
    status ? attendance(status) : null,
    includesReason(item, 'rookie_paired_with_veteran')
      || includesReason(item, 'veteran_for_foursome')
      ? composition(item)
      : null,
    item.remainingRounds == null || atLimit
      ? null
      : t('remainingShort', { n: String(item.remainingRounds) }),
    t('experienceShort', { level: skill(item) }),
  ].filter(value => value !== null)

  return facts.slice(0, 3).join(' · ')
}

export function recommendationDetailFacts(
  item: RecommendationForExplanation,
  attendanceFallback?: RecommendationAttendanceStatus,
) {
  const status = item.attendanceStatus ?? attendanceFallback
  return {
    rating: item.ratingAverage == null
      ? t('ratingNone')
      : t('ratingValue', {
          value: item.ratingAverage.toFixed(1),
          n: String(item.ratingCount),
        }),
    experience: skill(item),
    remaining: item.remainingRounds == null
      ? t('unknown')
      : t('remainingValue', { n: String(item.remainingRounds) }),
    attendance: attendance(status),
    composition: composition(item),
  }
}

export function RecommendationExplanation({
  item,
  attendanceFallback,
}: {
  item: RecommendationForExplanation
  attendanceFallback?: RecommendationAttendanceStatus
}) {
  const facts = recommendationDetailFacts(item, attendanceFallback)

  return (
    <div className="recommendation-explanation">
      <p className="recommendation-explanation-summary">
        {recommendationSummary(item, attendanceFallback)}
      </p>
      <details>
        <summary>{t('open')}</summary>
        <dl>
          <div>
            <dt>{t('ratingLabel')}</dt>
            <dd>{facts.rating}</dd>
          </div>
          <div>
            <dt>{t('experienceLabel')}</dt>
            <dd>{facts.experience}</dd>
          </div>
          <div>
            <dt>{t('remainingLabel')}</dt>
            <dd>{facts.remaining}</dd>
          </div>
          <div>
            <dt>{t('attendanceLabel')}</dt>
            <dd>{facts.attendance}</dd>
          </div>
          <div>
            <dt>{t('compositionLabel')}</dt>
            <dd>{facts.composition}</dd>
          </div>
        </dl>
        <p className="recommendation-order-value">
          {t('orderValue', { value: String(item.recommendationScore) })}
        </p>
        <p className="recommendation-order-note">{t('orderValueNote')}</p>
      </details>
    </div>
  )
}
