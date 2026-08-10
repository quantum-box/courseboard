import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import { useResource } from '../../hooks/useResource'
import { navigateFromClick } from '../../lib/router'
import { employmentLabel, isEmploymentActive, skillLabel } from './caddieLabels'

const COURSE_API = '/v1/course'

/** The roster fields the preview reads. The list carries more; this is enough. */
type PreviewProfile = {
  id: string
  displayName: string
  skillLevel?: string
  rank?: string
  employmentStatus?: string
  maxRoundsPerDay?: number
  monthlyContractRounds?: number
  ratingAverage?: number | null
  ratingCount?: number
  staffId?: string | null
}

/**
 * A caddie's name, wherever one is shown.
 *
 * The screens all carried their own version of "look up the profile, print
 * `displayName`, fall back to the id" — so a caddie read differently on the
 * assignment board, the attendance list and the shift board, and none of them
 * went anywhere. Whoever the desk is looking at, they usually want the same
 * next thing: that caddie's own screen, where the day-off requests, the staff
 * link and the ratings are.
 *
 * Hovering (or tabbing to) the name shows the few figures that answer "can
 * this person take another round" without leaving the board. It is a preview,
 * never the only way to something: everything in it is on the caddie's screen,
 * which the same control opens.
 *
 * The initial is there to make a column of names scannable at a glance rather
 * than to identify anybody — the name itself is always shown next to it.
 */
export function CaddieLink({
  caddieId,
  displayName,
  fallback,
}: {
  caddieId?: string | null
  displayName?: string | null
  /** Shown when neither a name nor an id is known. */
  fallback?: string
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [previewing, setPreviewing] = useState(false)
  const previewId = useId()
  const name = displayName?.trim()
  const label = name || caddieId || fallback || '—'

  // Asked for only once the desk lingers on a name, and shared with every other
  // reader of the roster through the cache key — a board holds dozens of these.
  const roster = useResource(
    useCallback(
      () => courseboardApiJson<{ items: PreviewProfile[] }>(`${COURSE_API}/caddie-profiles`),
      [],
    ),
    [],
    { cacheKey: 'caddie-profiles:list', enabled: previewing && Boolean(caddieId) },
  )
  const profile = roster.data?.items.find(item => item.id === caddieId) ?? null

  // Without an id there is nowhere to go and nothing to preview. An unlinked
  // row still has to read as a name, so it stays text rather than becoming a
  // button that does nothing.
  if (!caddieId) return <span className="caddie-link-plain">{label}</span>

  return (
    <span
      className="caddie-link-wrap"
      onMouseEnter={() => setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
    >
      <button
        type="button"
        className="caddie-link"
        aria-describedby={previewing ? previewId : undefined}
        onFocus={() => setPreviewing(true)}
        onBlur={() => setPreviewing(false)}
        onClick={event => navigateFromClick(event, `golf/caddies/${encodeURIComponent(caddieId)}`)}
      >
        <span className="caddie-link-initial" aria-hidden="true">{initialOf(label)}</span>
        <span className="caddie-link-name">{label}</span>
      </button>
      {previewing ? (
        <span className="caddie-preview" id={previewId} role="note">
          <span className="caddie-preview-name">{profile?.displayName ?? label}</span>
          {profile ? (
            <>
              <span className="caddie-preview-line">
                {[
                  profile.skillLevel ? skillLabel(profile.skillLevel) : null,
                  profile.rank ? t('caddies:preview.rank', { rank: profile.rank }) : null,
                  profile.maxRoundsPerDay
                    ? t('caddies:preview.perDay', { n: String(profile.maxRoundsPerDay) })
                    : null,
                ].filter(Boolean).join(' · ')}
              </span>
              <span className="caddie-preview-line">
                {profile.ratingAverage != null
                  ? t('caddies:preview.ratings', {
                      value: profile.ratingAverage.toFixed(1),
                      n: String(profile.ratingCount ?? 0),
                    })
                  : t('caddies:preview.ratingsNone')}
              </span>
              {profile.employmentStatus && !isEmploymentActive(profile.employmentStatus) ? (
                <span className="caddie-preview-warning">
                  {employmentLabel(profile.employmentStatus)}
                </span>
              ) : null}
              {profile.staffId ? null : (
                <span className="caddie-preview-warning">{t('caddies:preview.noStaffLink')}</span>
              )}
            </>
          ) : (
            <span className="caddie-preview-line">
              {roster.error ? t('caddies:preview.failed') : t('caddies:preview.loading')}
            </span>
          )}
          <span className="caddie-preview-hint">{t('caddies:preview.open')}</span>
        </span>
      ) : null}
    </span>
  )
}

/**
 * The first character of a name, for the badge.
 *
 * Japanese names start with the family name, so one character already sorts
 * most of a roster. Ids fall back to their first character too, which is
 * meaningless but keeps the row the same height as its neighbours.
 */
function initialOf(label: string): string {
  return [...label.trim()][0] ?? '?'
}
