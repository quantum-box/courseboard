import { Badge, Button } from '@tachyon-sdk/native-ui'
import { UserPlus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import { EmptyState, LoadingState, Panel, ResourceError } from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'

const COURSE_API = '/v1/course'

type ListResponse<T> = { items: T[] }

/** The parts of a tee-sheet row this panel needs. */
type TeeSheetRow = {
  id: string
  reservationNumber: string
  courseName: string
  teeTime: string
  playType: string
  partySize: number
  partyName?: string
  displayName?: string
}

type DayAssignment = {
  reservationId?: string | null
  status: string
}

type Candidate = {
  caddieProfileId: string
  displayName: string
  skillLevel: string
  recommendationScore: number
  roundsAssigned: number
  rationale: string[]
}

/**
 * A round still has a caddie when the row is anything but cancelled: a
 * completed round was staffed, and re-offering it would double-book it.
 */
function holdsTheRound(assignment: DayAssignment) {
  return assignment.status !== 'cancelled'
}

export function unassignedCaddieRounds(
  rows: TeeSheetRow[],
  assignments: DayAssignment[],
): TeeSheetRow[] {
  const covered = new Set(
    assignments
      .filter(holdsTheRound)
      .map(assignment => assignment.reservationId)
      .filter((id): id is string => Boolean(id)),
  )
  return rows.filter(row => row.playType === 'caddie' && !covered.has(row.id))
}

/** `2026-08-08T07:00:00+09:00` → `07:00`, for a row the desk reads at a glance. */
export function wallClock(teeTime: string): string {
  const match = /T(\d{2}:\d{2})/.exec(teeTime)
  return match ? match[1]! : teeTime
}

/**
 * The caddie-attached groups nobody is on yet, and the way to put someone there.
 *
 * The automatic run covers the ordinary morning. This is what the desk needs
 * for everything else — a named request, a swap, a round the plan could not
 * fill — and until now there was no way to do it from CourseBoard at all.
 */
export function UnassignedRoundsPanel({
  date,
  assignments,
  onChanged,
}: {
  date: string
  assignments: DayAssignment[]
  onChanged: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [naming, setNaming] = useState<TeeSheetRow | null>(null)

  const sheet = useResource(
    useCallback(
      () =>
        courseboardApiJson<{ items: TeeSheetRow[] }>(
          `${COURSE_API}/tee-sheet?date=${encodeURIComponent(date)}`,
        ),
      [date],
    ),
    [date],
  )

  const rounds = useMemo(
    () => unassignedCaddieRounds(sheet.data?.items ?? [], assignments),
    [sheet.data, assignments],
  )

  return (
    <Panel title={t('caddies:unassigned.title')} description={t('caddies:unassigned.description')}>
      {sheet.loading ? <LoadingState label={t('caddies:unassigned.loading')} /> : null}
      {sheet.error ? <ResourceError error={sheet.error} onRetry={sheet.refresh} /> : null}
      {!sheet.loading && !sheet.error && rounds.length === 0 ? (
        <EmptyState
          title={t('caddies:unassigned.empty.title')}
          description={t('caddies:unassigned.empty.description')}
        />
      ) : null}

      <div className="space-y-2">
        {rounds.map(round => (
          <div
            key={round.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3"
          >
            <span className="font-mono text-sm font-semibold">{wallClock(round.teeTime)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">
                {round.partyName || round.reservationNumber}
              </p>
              <p className="text-xs text-muted-foreground">
                {round.courseName} · {t('caddies:unassigned.players', { n: String(round.partySize) })}
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setNaming(round)}>
              <UserPlus />
              {t('caddies:unassigned.name')}
            </Button>
          </div>
        ))}
      </div>

      <NameCaddieSheet
        round={naming}
        onClose={() => setNaming(null)}
        onNamed={() => {
          setNaming(null)
          sheet.refresh()
          onChanged()
        }}
      />
    </Panel>
  )
}

/**
 * Pick who takes one round.
 *
 * The candidates are the same ranking the board shows, asked for this tee time
 * so the day off and half-day requests filed on the shift board are honoured.
 */
function NameCaddieSheet({
  round,
  onClose,
  onNamed,
}: {
  round: TeeSheetRow | null
  onClose: () => void
  onNamed: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [saving, setSaving] = useState<string | null>(null)

  const candidates = useResource(
    useCallback(() => {
      if (!round) return Promise.resolve({ items: [] as Candidate[] })
      const params = new URLSearchParams({
        scheduledAt: round.teeTime,
        playerCount: String(round.partySize),
        limit: '10',
      })
      return courseboardApiJson<ListResponse<Candidate>>(
        `${COURSE_API}/caddie-recommendations?${params}`,
      )
    }, [round]),
    [round?.id],
    { enabled: round !== null },
  )

  async function name(candidate: Candidate) {
    if (!round) return
    setSaving(candidate.caddieProfileId)
    try {
      await courseboardApiJson(`${COURSE_API}/caddie-assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caddieProfileId: candidate.caddieProfileId,
          reservationId: round.id,
          scheduledAt: round.teeTime,
        }),
      })
      showToast({
        tone: 'success',
        message: t('caddies:unassigned.named', { name: candidate.displayName }),
      })
      onNamed()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('caddies:unassigned.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Sheet
      open={round !== null}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title={t('caddies:unassigned.sheetTitle')}
      description={
        round
          ? t('caddies:unassigned.sheetDescription', {
              time: wallClock(round.teeTime),
              course: round.courseName,
            })
          : undefined
      }
    >
      <div className="space-y-2">
        {candidates.loading ? <LoadingState label={t('caddies:unassigned.loadingCandidates')} /> : null}
        {candidates.error ? (
          <ResourceError error={candidates.error} onRetry={candidates.refresh} />
        ) : null}
        {!candidates.loading && !candidates.error && (candidates.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title={t('caddies:unassigned.noCandidates.title')}
            description={t('caddies:unassigned.noCandidates.description')}
          />
        ) : null}

        {candidates.data?.items.map((candidate, index) => (
          <div
            key={candidate.caddieProfileId}
            className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected text-sm font-semibold text-primary">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{candidate.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {t('caddies:unassigned.candidateMeta', {
                  score: String(candidate.recommendationScore),
                  rounds: String(candidate.roundsAssigned),
                })}
              </p>
            </div>
            <Badge variant="accent">{candidate.recommendationScore}</Badge>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving !== null}
              onClick={() => void name(candidate)}
            >
              {saving === candidate.caddieProfileId
                ? t('caddies:unassigned.naming')
                : t('caddies:unassigned.pick')}
            </Button>
          </div>
        ))}
      </div>
    </Sheet>
  )
}
