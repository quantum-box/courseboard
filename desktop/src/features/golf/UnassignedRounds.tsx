import { Button } from '@tachyon-sdk/native-ui'
import { UserPlus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  EmptyState,
  Field,
  LoadingState,
  NativeSelect,
  Panel,
  ResourceError,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'
import {
  RecommendationExplanation,
  type RecommendationForExplanation,
} from './RecommendationExplanation'

const COURSE_API = '/v1/course'

type ListResponse<T> = { items: T[] }

/** Structurally the same as the caddie screen's, which is what gets passed in. */
type ResourceValue<T> = {
  data: T | null
  error: unknown
  loading: boolean
  refresh: () => void
}

/** The parts of a tee-sheet row this panel needs. */
export type TeeSheetRow = {
  id: string
  reservationNumber: string
  golfCourseId: string
  courseName: string
  teeTime: string
  playType: string
  partySize: number
  partyName?: string
  displayName?: string
  /** Absent on older rows; only the cancelled states are read here. */
  status?: string
}

type DayAssignment = {
  id?: string
  reservationId?: string | null
  status: string
}

type Candidate = RecommendationForExplanation & {
  caddieProfileId: string
  displayName: string
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
  return rows
    .filter(roundIsStillOn)
    .filter(row => row.playType === 'caddie' && !covered.has(row.id))
}

/** Whether a tee-sheet row is a group somebody is still going to play. */
function roundIsStillOn(row: TeeSheetRow) {
  return row.status !== 'cancelled' && row.status !== 'rejected'
}

/**
 * Assignments left standing on a group that is no longer being played.
 *
 * Cancelling through CourseBoard now releases the caddie, but a booking
 * cancelled upstream — or cancelled before that fix shipped — leaves a row
 * behind, and it goes on counting against the caddie's day and their month.
 * The desk cannot see it: the group is gone from the tee sheet, so nothing on
 * the board says why the caddie is busy.
 *
 * Read against a tee sheet that failed or has not arrived, every assignment
 * would look orphaned, so an empty sheet answers nothing at all.
 */
export function assignmentsOnCancelledRounds<T extends DayAssignment>(
  rows: TeeSheetRow[],
  assignments: T[],
): T[] {
  if (rows.length === 0) return []
  const stillOn = new Set(rows.filter(roundIsStillOn).map(row => row.id))
  return assignments
    .filter(holdsTheRound)
    .filter(assignment => Boolean(assignment.reservationId))
    .filter(assignment => !stillOn.has(assignment.reservationId!))
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
  sheet,
  assignments,
  onChanged,
}: {
  sheet: ResourceValue<{ items: TeeSheetRow[] }>
  assignments: DayAssignment[]
  onChanged: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [naming, setNaming] = useState<TeeSheetRow | null>(null)
  // The board is every course at once, which is right for a desk that runs
  // several — but staffing one course at a time is the usual way through it.
  const [courseFilter, setCourseFilter] = useState('')

  const rounds = useMemo(
    () => unassignedCaddieRounds(sheet.data?.items ?? [], assignments),
    [sheet.data, assignments],
  )
  const courses = useMemo(() => {
    const named = new Map<string, string>()
    for (const row of rounds) named.set(row.golfCourseId, row.courseName)
    return [...named].map(([id, name]) => ({ id, name }))
  }, [rounds])
  const shown = useMemo(
    () => (courseFilter === '' ? rounds : rounds.filter(row => row.golfCourseId === courseFilter)),
    [rounds, courseFilter],
  )

  return (
    <Panel
      title={t('caddies:unassigned.title')}
      description={t('caddies:unassigned.description')}
      actions={courses.length > 1 ? (
        <Field label={t('caddies:unassigned.courseFilter')} requirement="none" className="w-full sm:w-48">
          <NativeSelect
            value={courseFilter}
            onChange={event => setCourseFilter(event.target.value)}
          >
            <option value="">{t('caddies:unassigned.allCourses')}</option>
            {courses.map(course => (
              <option key={course.id} value={course.id}>{course.name}</option>
            ))}
          </NativeSelect>
        </Field>
      ) : undefined}
    >
      {sheet.loading ? <LoadingState label={t('caddies:unassigned.loading')} /> : null}
      {sheet.error ? <ResourceError error={sheet.error} onRetry={sheet.refresh} /> : null}
      {!sheet.loading && !sheet.error && shown.length === 0 ? (
        <EmptyState
          title={t('caddies:unassigned.empty.title')}
          description={t('caddies:unassigned.empty.description')}
        />
      ) : null}

      <div className="space-y-2">
        {shown.map(round => (
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
        // Whoever walks this group stands on its course. Once the month is
        // confirmed the candidates come from there; before that the API still
        // offers the whole roster.
        golfCourseId: round.golfCourseId,
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
            className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
          >
            <div className="flex h-11 min-w-11 shrink-0 self-start items-center justify-center rounded-full bg-selected px-2 font-semibold text-primary">
              {t('caddies:recommendations.rank', { n: String(index + 1) })}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{candidate.displayName}</p>
              <RecommendationExplanation item={candidate} />
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="min-h-11"
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
