import { Badge, Button } from '@tachyon-sdk/native-ui'
import { List, Table2, UserPlus, Shuffle } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson, COURSE_TIME_ZONE } from '../../api'
import {
  EmptyState,
  LoadingState,
  NativeSelect,
  Panel,
  ResourceError,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { ReassignRoundSheet, type MovingAssignment } from './ReassignRoundSheet'
import { CaddieLink } from './CaddieLink'
import { placementWarningStatus, type ShiftPlacementStatus } from './caddiePlacement'
import { holdsTheRound, roundIsStillOn } from './caddieRoundCoverage'
import type { PartyDetails } from './ledger/models'
import { UnassignedRoundsLedger } from './UnassignedRoundsLedger'
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
  durationMinutes?: number
  party?: PartyDetails | null
  /** Absent on older rows; only the cancelled states are read here. */
  status?: string
}

type DayAssignment = {
  id?: string
  reservationId?: string | null
  status: string
  canonicalStatus?: string | null
  caddieProfileId?: string
  scheduledAt?: string
}

type Candidate = RecommendationForExplanation & {
  caddieProfileId: string
  displayName: string
  shiftPlacementStatus?: ShiftPlacementStatus | null
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

/** `2026-08-08T07:00:00+09:00` → `8/8 (土)`, for a list that spans days. */
export function dayLabel(teeTime: string): string {
  const at = new Date(teeTime)
  if (Number.isNaN(at.getTime())) return teeTime.slice(0, 10)
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: COURSE_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(at)
}

/** How far ahead the panel looks, in days from the chosen date. */
export const HORIZONS = [1, 7, 14] as const
export type Horizon = (typeof HORIZONS)[number]

/** The last day a horizon covers, as `YYYY-MM-DD`. */
export function horizonEnd(date: string, horizon: Horizon): string {
  if (horizon <= 1) return date
  const start = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return date
  start.setUTCDate(start.getUTCDate() + horizon - 1)
  return start.toISOString().slice(0, 10)
}

/** Club names group the existing course labels without depending on fixture IDs. */
export function dispatchClub(name: string): string {
  if (/真駒内|空沼|藻岩/.test(name)) return '真駒内'
  if (/滝の/.test(name)) return '滝の'
  if (/羊[ヶケが]丘/.test(name)) return '羊ヶ丘'
  return 'その他'
}

/** All caddie bookings stay on the board while the desk fills the open groups. */
export function UnassignedRoundsPanel({
  sheet,
  assignments,
  profiles = [],
  horizon,
  onHorizonChange,
  onChanged,
  toolbar,
}: {
  sheet: ResourceValue<{ items: TeeSheetRow[] }>
  assignments: DayAssignment[]
  profiles?: { id: string; displayName: string }[]
  horizon: Horizon
  onHorizonChange: (horizon: Horizon) => void
  onChanged: () => void
  toolbar?: ReactNode
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [naming, setNaming] = useState<TeeSheetRow | null>(null)
  const [moving, setMoving] = useState<{ assignment: MovingAssignment; date: string } | null>(null)
  const timezone = useTenantTimezone()
  const localDate = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
  // Keep a club's start courses together, with an optional course filter.
  const [courseFilter, setCourseFilter] = useState('')
  const [clubFilter, setClubFilter] = useState('')
  const [view, setView] = useState<'ledger' | 'list'>('ledger')

  const rounds = useMemo(
    () => (sheet.data?.items ?? []).filter(row => roundIsStillOn(row) && row.playType === 'caddie'),
    [sheet.data],
  )
  const courses = useMemo(() => {
    const named = new Map<string, string>()
    for (const row of sheet.data?.items ?? []) {
      if (roundIsStillOn(row) && row.playType === 'caddie') named.set(row.golfCourseId, row.courseName)
    }
    return [...named].map(([id, name]) => ({ id, name }))
  }, [sheet.data])
  const clubs = useMemo(() => {
    const grouped = new Map<string, typeof courses>()
    for (const course of courses) {
      const club = dispatchClub(course.name)
      grouped.set(club, [...(grouped.get(club) ?? []), course])
    }
    const order = ['真駒内', '滝の', '羊ヶ丘']
    return [...grouped].map(([name, items]) => {
      const courseRank = (label: string) => {
        if (name === '真駒内') return (label.includes('藻岩') ? 2 : 0) + (/IN/i.test(label) ? 1 : 0)
        if (name === '滝の') return label.includes('東') ? 0 : label.includes('中') ? 1 : 2
        return /IN/i.test(label) ? 1 : 0
      }
      return [name, [...items].sort((a, b) => courseRank(a.name) - courseRank(b.name))] as const
    }).sort(([a], [b]) => {
      const rank = (name: string) => order.includes(name) ? order.indexOf(name) : order.length
      return rank(a) - rank(b)
    })
  }, [courses])
  const activeClub = clubs.some(([name]) => name === clubFilter) ? clubFilter : clubs[0]?.[0]
  const clubCourses = clubs.find(([name]) => name === activeClub)?.[1] ?? []
  const activeCourseFilter = clubCourses.some(course => course.id === courseFilter) ? courseFilter : ''
  const assignedCaddies = useMemo(() => {
    const names = new Map(profiles.map(profile => [profile.id, profile.displayName]))
    const result = new Map<string, { id: string; name: string; assignmentId?: string }[]>()
    for (const assignment of assignments.filter(holdsTheRound)) {
      if (!assignment.reservationId) continue
      const id = assignment.caddieProfileId ?? ''
      const current = result.get(assignment.reservationId) ?? []
      current.push({ id, name: names.get(id) ?? (id || t('caddies:unassigned.assigned')),
        assignmentId: id && (assignment.canonicalStatus ?? assignment.status) === 'assigned' ? assignment.id : undefined })
      result.set(assignment.reservationId, current)
    }
    return result
  }, [assignments, profiles, t])
  const shown = useMemo(() => {
    const courseIds = new Set(clubCourses.map(course => course.id))
    return rounds.filter(row => courseIds.has(row.golfCourseId) && (!activeCourseFilter || row.golfCourseId === activeCourseFilter))
      .sort((left, right) => left.teeTime.localeCompare(right.teeTime))
  }, [rounds, clubCourses, activeCourseFilter])
  const byDay = useMemo(() => {
    const days = new Map<string, TeeSheetRow[]>()
    for (const round of shown) {
      const day = dayLabel(round.teeTime)
      const list = days.get(day) ?? []
      list.push(round)
      days.set(day, list)
    }
    return [...days]
  }, [shown])

  function changeCaddie(round: TeeSheetRow, assignmentId?: string) {
    const current = assignments.find(item => item.reservationId === round.id && item.id
      && item.caddieProfileId && (item.canonicalStatus ?? item.status) === 'assigned'
      && (!assignmentId || item.id === assignmentId))
    if (!current?.id || !current.caddieProfileId) return
    setMoving({ assignment: { ...current, id: current.id, caddieProfileId: current.caddieProfileId,
      scheduledAt: current.scheduledAt ?? round.teeTime }, date: localDate(round.teeTime) })
  }

  function selectRound(round: TeeSheetRow) {
    if (assignedCaddies.has(round.id)) changeCaddie(round)
    else setNaming(round)
  }

  return (
    <Panel
      title={t('caddies:unassigned.title')}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <div className="horizon-switch unassigned-view-switch" role="group" aria-label={t('caddies:unassigned.viewLabel')}>
            {(['ledger', 'list'] as const).map(option => (
              <button key={option} type="button" className={`horizon-chip${view === option ? ' is-on' : ''}`}
                aria-pressed={view === option} onClick={() => setView(option)}>
                {option === 'ledger' ? <Table2 aria-hidden="true" /> : <List aria-hidden="true" />}
                {t(`caddies:unassigned.views.${option}`)}
              </button>
            ))}
          </div>
          {clubs.length > 1 ? (
            <div className="horizon-switch" role="group" aria-label={t('caddies:unassigned.clubFilter')}>
              {clubs.map(([name]) => <button key={name} type="button"
                className={`horizon-chip${name === activeClub ? ' is-on' : ''}`} aria-pressed={name === activeClub}
                onClick={() => { setClubFilter(name); setCourseFilter('') }}>{name}</button>)}
            </div>
          ) : null}
          {clubCourses.length > 1 ? (
            <div className="w-full sm:w-48">
              <NativeSelect
                aria-label={t('caddies:unassigned.courseFilter')}
                value={activeCourseFilter}
                onChange={event => setCourseFilter(event.target.value)}
              >
                <option value="">{t('caddies:unassigned.allCourses')}</option>
                {clubCourses.map(course => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          {/* Staffing runs ahead of the day, so the groups still missing
              somebody are read a fortnight at a time as well as one day. */}
          <div className="horizon-switch" role="group" aria-label={t('caddies:unassigned.horizonLabel')}>
            {HORIZONS.map(option => (
              <button
                key={option}
                type="button"
                className={`horizon-chip${option === horizon ? ' is-on' : ''}`}
                aria-pressed={option === horizon}
                onClick={() => onHorizonChange(option)}
              >
                {t(`caddies:unassigned.horizon.${option}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    >
      {sheet.loading ? <LoadingState label={t('caddies:unassigned.loading')} /> : null}
      {sheet.error ? <ResourceError error={sheet.error} onRetry={sheet.refresh} /> : null}
      {!sheet.loading && !sheet.error && shown.length === 0 ? (
        <EmptyState
          title={t('caddies:unassigned.noBookings.title')}
          description={t('caddies:unassigned.noBookings.description')}
        />
      ) : null}

      {/* A fortnight of a club-sized board is a couple of hundred groups. The
          list scrolls inside the panel rather than pushing the rest of the
          screen down, and each day says how many it holds so the desk can see
          which day needs the work without reading every row. */}

      <div className={view === 'list' ? 'unassigned-scroll' : 'dispatch-ledger-days'}>
        {!sheet.loading && !sheet.error ? byDay.map(([day, dayRounds]) => (
          <section key={day} className="unassigned-day">
            {horizon > 1 ? (
              <h3 className="unassigned-day-heading">
                <span>{day}</span>
                <span className="unassigned-day-count">
                  {t('caddies:unassigned.dayCount', { n: String(dayRounds.length) })}
                </span>
              </h3>
            ) : null}
            {view === 'ledger' ? (
              <UnassignedRoundsLedger rounds={dayRounds} courseOrder={clubCourses.map(course => course.id)}
                assignedCaddies={assignedCaddies} selectedId={naming?.id ?? moving?.assignment.reservationId ?? null} onSelect={selectRound} onChangeCaddie={changeCaddie} />
            ) : (
              <div className="space-y-2">
                {dayRounds.map(round => (
                  <div
                    key={round.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <span className="font-mono text-sm font-semibold">
                      {wallClock(round.teeTime)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {round.partyName || round.reservationNumber}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {round.courseName} · {t('caddies:unassigned.players', { n: String(round.partySize) })}
                      </p>
                    </div>
                    {assignedCaddies.has(round.id) ? (
                      <div className="dispatch-assigned-caddies">
                        {assignedCaddies.get(round.id)?.map((caddie, index) => <div key={`${caddie.id}-${index}`} className="flex items-center gap-2">
                          <CaddieLink caddieId={caddie.id} displayName={caddie.name} />
                          {caddie.assignmentId ? <Button type="button" variant="ghost" size="sm"
                            aria-label={t('caddies:unassigned.changeCaddie', { name: caddie.name, time: wallClock(round.teeTime) })}
                            onClick={() => changeCaddie(round, caddie.assignmentId)}><Shuffle aria-hidden="true" />{t('caddies:reassign.action')}</Button> : null}
                        </div>)}
                      </div>
                    ) : <Button type="button" variant="secondary" size="sm" onClick={() => setNaming(round)}>
                      <UserPlus />{t('caddies:unassigned.name')}
                    </Button>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )) : null}
      </div>

      <ReassignRoundSheet
        key={moving?.assignment.id ?? 'closed'}
        assignment={moving?.assignment ?? null}
        date={moving?.date ?? ''}
        rounds={(sheet.data?.items ?? []).filter(round => round.id === moving?.assignment.reservationId)}
        assignments={assignments.filter((item): item is DayAssignment & { id: string; caddieProfileId: string } => Boolean(item.id && item.caddieProfileId))}
        caddieNames={new Map(profiles.map(profile => [profile.id, profile.displayName]))}
        onClose={() => setMoving(null)}
        onMoveDone={() => { setMoving(null); sheet.refresh(); onChanged() }}
      />

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
export function NameCaddieSheet({
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
    const placement = placementWarningStatus(candidate.shiftPlacementStatus)
    if (placement) {
      const placementLabel = t(`caddies:shiftPlacement.${placement}`)
      const message = [
        t('caddies:assignment.shiftPlacementWarning.title'),
        t('caddies:assignment.shiftPlacementWarning.body', {
          name: candidate.displayName,
          status: placementLabel,
        }),
        t('caddies:assignment.shiftPlacementWarning.confirm'),
      ].join('\n\n')
      if (!window.confirm(message)) return
    }
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
          // The list spans days, so the sheet has to say which one it is
          // about: a start time alone reads as today.
          ? t('caddies:unassigned.sheetDescription', {
              date: dayLabel(round.teeTime),
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
              <div className="flex flex-wrap items-center gap-2">
                <CaddieLink
                  caddieId={candidate.caddieProfileId}
                  displayName={candidate.displayName}
                />
                {(() => {
                  const placement = placementWarningStatus(candidate.shiftPlacementStatus)
                  return placement ? (
                    <Badge variant="warning">
                      {t(`caddies:shiftPlacement.${placement}`)}
                    </Badge>
                  ) : null
                })()}
              </div>
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
