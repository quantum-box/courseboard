import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Columns2,
  GanttChart,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Table2,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, nowIsoMinute, today } from '../../../api'
import { MOCK_FIXTURE_DATE, isMockFieldDataEnabled } from '../../../dev/mockFieldApi'
import { i18next } from '../../../i18n'
import {
  EmptyState,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
} from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { useRegisterPageReload } from '../../../lib/pageReload'
import { navigate } from '../../../lib/router'
import { useResource } from '../../../hooks/useResource'
import type {
  AssignmentCoverage,
  TeeReservation,
  TeeSheetResponse,
  TimelineAssignment,
  TimelineCaddie,
} from './models'
import {
  DEFAULT_PX_PER_HOUR,
  assignStackLanes,
  DEFAULT_TIMELINE_WINDOW,
  MAX_PX_PER_HOUR,
  MIN_PX_PER_HOUR,
  PX_PER_HOUR_STEP,
  buildHourMarks,
  clampPxPerHour,
  coverageForReservation,
  enrichAssignmentsForTimeline,
  findOverlappingAssignmentIds,
  formatCoverageLabel,
  markStepMinutes,
  parseClockMinutes,
  teeTickGeometry,
  type TeeTickGeometry,
  minutesToLabel,
  nowLinePercent,
  parseJstDateParts,
  parseLocalDateParts,
  summarizeDay,
  toTimelineBlock,
  trackWidthPx,
  zoomPercent,
} from './timelineLayout'

const COURSE_API = '/v1/course'
const LANE_WIDTH_PX = 168
/** How often the "now" line catches up with the clock. */
const NOW_TICK_MS = 30_000

type ListResponse<T> = { items: T[] }

type Selection =
  | { kind: 'reservation'; id: string }
  | { kind: 'assignment'; id: string }
  | null

type BoardView = 'split' | 'tee' | 'caddie'
type DisplayMode = 'timeline' | 'tiles'

const BOARD_VIEW_STORAGE_KEY = 'courseboard.timeline.boardView'
const DISPLAY_MODE_STORAGE_KEY = 'courseboard.timeline.displayMode'
const ZOOM_STORAGE_KEY = 'courseboard.timeline.pxPerHour'

function readBoardView(): BoardView {
  try {
    const raw = localStorage.getItem(BOARD_VIEW_STORAGE_KEY)
    if (raw === 'tee' || raw === 'caddie' || raw === 'split') return raw
  } catch {
    // ignore storage failures
  }
  return 'split'
}

function readDisplayMode(): DisplayMode {
  try {
    const raw = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY)
    if (raw === 'timeline' || raw === 'tiles') return raw
  } catch {
    // ignore storage failures
  }
  return 'timeline'
}

function readPxPerHour(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY)
    if (!raw) return DEFAULT_PX_PER_HOUR
    return clampPxPerHour(Number(raw))
  } catch {
    return DEFAULT_PX_PER_HOUR
  }
}

function todayIsoDate() {
  return today()
}

/**
 * The day the demo affordance sends the operator to, or `null` when there is
 * no demo to show.
 *
 * The button used to be unconditional, so on a real tenant with an empty day
 * it offered to move the operator off today and onto a date in the past that
 * holds no data at all — the fixtures it was written for only exist while the
 * mock API is serving.
 */
function demoDateOrNull() {
  return isMockFieldDataEnabled() ? MOCK_FIXTURE_DATE : null
}

/**
 * The current course-local minute, kept live.
 *
 * The now line used to be pinned to the date the demo fixtures were written
 * for, so on a real board it pointed at a moment that had nothing to do with
 * the round in progress.
 */
function useCurrentMinute() {
  const [now, setNow] = useState(nowIsoMinute)
  useEffect(() => {
    const timer = setInterval(() => setNow(nowIsoMinute()), NOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

function shiftDate(isoDate: string, deltaDays: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1, day! + deltaDays))
  return next.toISOString().slice(0, 10)
}

/** API enum values map onto `timeline:status`; anything unknown is shown as-is. */
const STATUS_KEYS: Record<string, string> = {
  confirmed: 'confirmed',
  checked_in: 'checkedIn',
  on_course: 'playing',
  completed: 'finished',
  cancelled: 'cancelled',
  no_show: 'noShow',
  assigned: 'assigned',
  in_progress: 'inProgress',
}

function statusLabel(status: string) {
  const key = STATUS_KEYS[status]
  if (!key) return status.replaceAll('_', ' ')
  return i18next.t(`timeline:status.${key}` as 'timeline:status.confirmed')
}

function playTypeLabel(playType: string) {
  if (playType === 'caddie') return i18next.t('timeline:playType.caddie')
  if (playType === 'self') return i18next.t('timeline:playType.self')
  return playType
}

function productDisplayName(reservation: TeeReservation) {
  return reservation.displayName?.trim()
    || reservation.reservationServiceId?.trim()
    || i18next.t('timeline:plan.unnamed')
}

function productManagementNumber(reservation: TeeReservation) {
  return reservation.reservationServiceId?.trim() || i18next.t('timeline:plan.noId')
}

function roleLabel(role: string) {
  if (role === 'primary' || role === 'lead') return i18next.t('timeline:role.primary')
  if (role === 'assistant') return i18next.t('timeline:role.support')
  return role
}

function skillLabel(skill: string) {
  if (skill === 'veteran') return i18next.t('timeline:skill.veteran')
  if (skill === 'regular') return i18next.t('timeline:skill.regular')
  if (skill === 'junior') return i18next.t('timeline:skill.rookie')
  return skill
}

function coverageClass(coverage: AssignmentCoverage) {
  return `timeline-coverage timeline-coverage-${coverage}`
}

export function TimelinePage() {
  const { t } = useTranslation(['timeline', 'common'])
  const [date, setDate] = useState(todayIsoDate)
  const currentMinute = useCurrentMinute()
  const demoDate = demoDateOrNull()
  const [courseFilter, setCourseFilter] = useState('all')
  const [displayMode, setDisplayMode] = useState<DisplayMode>(readDisplayMode)
  const [boardView, setBoardView] = useState<BoardView>(readBoardView)
  const [pxPerHour, setPxPerHour] = useState(readPxPerHour)
  const [selection, setSelection] = useState<Selection>(null)

  useEffect(() => {
    try {
      localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode)
    } catch {
      // ignore storage failures
    }
  }, [displayMode])

  useEffect(() => {
    try {
      localStorage.setItem(BOARD_VIEW_STORAGE_KEY, boardView)
    } catch {
      // ignore storage failures
    }
  }, [boardView])

  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(pxPerHour))
    } catch {
      // ignore storage failures
    }
  }, [pxPerHour])

  const nudgeZoom = (delta: number) => {
    setPxPerHour(value => clampPxPerHour(value + delta))
  }

  const teeSheet = useResource(
    () => {
      const params = new URLSearchParams({ date })
      if (courseFilter !== 'all') params.set('golfCourseId', courseFilter)
      return courseboardApiJson<TeeSheetResponse>(`/v1/course/tee-sheet?${params}`)
    },
    [date, courseFilter],
    { cacheKey: `tee-sheet:${date}:${courseFilter}` },
  )
  const assignmentsResource = useResource(
    () => courseboardApiJson<ListResponse<TimelineAssignment>>(`${COURSE_API}/caddie-assignments`),
    [],
    { cacheKey: 'timeline:caddie-assignments' },
  )
  const caddiesResource = useResource(
    () => courseboardApiJson<ListResponse<TimelineCaddie>>(`${COURSE_API}/caddie-profiles`),
    [],
    { cacheKey: 'caddie-profiles:list' },
  )
  const coursesResource = useResource(
    () => courseboardApiJson<ListResponse<{
      id: string
      name: string
      isActive?: boolean
      startIntervalMinutes?: number
      businessHoursJson?: { open: string; close: string } | null
    }>>(`${COURSE_API}/courses`),
    [],
    { cacheKey: 'courses:list' },
  )

  const refreshAll = () => {
    teeSheet.refresh()
    assignmentsResource.refresh()
    caddiesResource.refresh()
    coursesResource.refresh()
  }
  useRegisterPageReload(refreshAll)

  useEffect(() => {
    setSelection(null)
  }, [date, courseFilter])

  const loading = teeSheet.loading || assignmentsResource.loading || caddiesResource.loading || coursesResource.loading
  const resources = [teeSheet, assignmentsResource, caddiesResource, coursesResource]
  // A first-load failure still replaces the page. A failed background refresh
  // keeps the successful snapshot visible and puts the retry beside it.
  const hardError = resources.find(resource => resource.error && !resource.data)?.error
  const refreshError = resources.find(resource => resource.error)?.error

  if (hardError) {
    return <ResourceError error={hardError} onRetry={refreshAll} />
  }
  if (loading && !teeSheet.data) {
    return <LoadingState label={t('timeline:loading')} />
  }

  const reservations = teeSheet.data?.items ?? []
  const unavailable = teeSheet.data?.unavailable ?? []
  const assignments = enrichAssignmentsForTimeline(
    (assignmentsResource.data?.items ?? []).filter(item =>
      parseJstDateParts(item.scheduledAt).date === date,
    ),
    reservations,
  )
  const caddies = (caddiesResource.data?.items ?? []).filter(
    profile => profile.employmentStatus === 'active',
  )
  const summary = summarizeDay(reservations, assignments)
  const conflicts = findOverlappingAssignmentIds(assignments)
  const hourMarks = buildHourMarks(DEFAULT_TIMELINE_WINDOW, markStepMinutes(pxPerHour))
  const nowPct = nowLinePercent(currentMinute, date)
  const trackWidth = trackWidthPx(pxPerHour)
  const courseOptions = (coursesResource.data?.items ?? [])
    .filter(course => course.isActive !== false)
    .map(course => [course.id, course.name] as const)

  const selectedReservation = selection?.kind === 'reservation'
    ? reservations.find(item => item.id === selection.id) ?? null
    : selection?.kind === 'assignment'
      ? reservations.find(item => {
          const asn = assignments.find(entry => entry.id === selection.id)
          return asn?.reservationId === item.id
        }) ?? null
      : null
  const selectedAssignment = selection?.kind === 'assignment'
    ? assignments.find(item => item.id === selection.id) ?? null
    : selectedReservation
      ? assignments.find(item => item.reservationId === selectedReservation.id) ?? null
      : null

  const courseSettings = new Map(
    (coursesResource.data?.items ?? []).map(course => [course.id, course]),
  )
  const courseRows = [...new Map(
    reservations.map(item => [item.golfCourseId, item.courseName]),
  ).entries()].map(([id, name]) => {
    const course = courseSettings.get(id)
    return {
      id,
      name,
      startIntervalMinutes: course?.startIntervalMinutes ?? null,
      openMinutes: parseClockMinutes(course?.businessHoursJson?.open),
      items: reservations
        .filter(item => item.golfCourseId === id)
        .sort((a, b) => a.teeTime.localeCompare(b.teeTime)),
    }
  })

  const conflictCount = Math.ceil(summary.conflicts / 2)
  const needsAttention = summary.unassigned > 0 || conflictCount > 0
  const attentionParts = [
    summary.unassigned > 0
      ? t('timeline:summary.unassignedPart', { n: String(summary.unassigned) })
      : null,
    conflictCount > 0 ? t('timeline:summary.conflictPart', { n: String(conflictCount) }) : null,
  ].filter(Boolean)

  return (
    <div className="page-stack timeline-page">
      {refreshError ? <ResourceError error={refreshError} onRetry={refreshAll} /> : null}
      {unavailable.length > 0 ? (
        <Notice tone="warning" title={t('timeline:partial.title')}>
          {t('timeline:partial.description')}
        </Notice>
      ) : null}
      <div className="timeline-chrome">
        <div className="page-toolbar">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate('golf/ledger')}>
            <Table2 />
            {t('timeline:toLedger')}
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={() => navigate('golf/caddies/dispatch')}>
            <ClipboardCheck />
            {t('timeline:toDispatch')}
          </Button>
        </div>

        <div
          className={`timeline-summary${needsAttention ? ' has-attention' : ''}`}
          aria-label={t('timeline:summary.label')}
        >
          <div className="timeline-summary-item">
            <span>{t('timeline:summary.tees')}</span>
            <strong>{summary.total}</strong>
            <small>
              {t('timeline:summary.teesDetail', {
                self: String(summary.selfPlay),
                caddie: String(summary.caddieRequired),
              })}
            </small>
          </div>
          <div className="timeline-summary-item">
            <span>{t('timeline:summary.assigned')}</span>
            <strong>{summary.assigned}</strong>
            <small>
              {t('timeline:summary.assignedDetail', {
                rate: String(Math.round(summary.coverageRate * 100)),
              })}
            </small>
          </div>
          <div className={`timeline-summary-item${summary.unassigned > 0 ? ' is-warning' : ''}`}>
            <span>{t('timeline:summary.unassigned')}</span>
            <strong>{summary.unassigned}</strong>
          </div>
          <div className={`timeline-summary-item${conflictCount > 0 ? ' is-danger' : ''}`}>
            <span>{t('timeline:summary.conflict')}</span>
            <strong>{conflictCount}</strong>
          </div>
          {needsAttention ? (
            <div className="timeline-summary-attention" role="status">
              <AlertTriangle aria-hidden="true" />
              <span>{t('timeline:summary.attention', { parts: attentionParts.join(' · ') })}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate('golf/caddies/dispatch')}>
                {t('timeline:toDispatch')}
              </Button>
            </div>
          ) : (
            <div className="timeline-summary-attention is-clear" role="status">
              <span>{t('timeline:summary.ok')}</span>
            </div>
          )}
        </div>

        <section className="timeline-toolbar" aria-label={t('timeline:toolbar.label')}>
          <div className="timeline-date-controls">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('timeline:toolbar.prevDay')}
              onClick={() => setDate(value => shiftDate(value, -1))}
            >
              <ChevronLeft />
            </Button>
            <label className="timeline-inline-field">
              <span>{t('timeline:toolbar.date')}</span>
              <Input
                type="date"
                value={date}
                onChange={event => setDate(event.target.value || todayIsoDate())}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('timeline:toolbar.nextDay')}
              onClick={() => setDate(value => shiftDate(value, 1))}
            >
              <ChevronRight />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDate(todayIsoDate())}>
              <CalendarRange />
              {t('timeline:toolbar.today')}
            </Button>
          </div>
          <label className="timeline-inline-field">
            <span>{t('timeline:toolbar.course')}</span>
            <NativeSelect value={courseFilter} onChange={event => setCourseFilter(event.target.value)}>
              <option value="all">{t('timeline:toolbar.allCourses')}</option>
              {courseOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </NativeSelect>
          </label>
          <div className="timeline-view-toggle" role="group" aria-label={t('timeline:toolbar.viewMode')}>
            <Button
              type="button"
              size="sm"
              variant={displayMode === 'timeline' ? 'primary' : 'ghost'}
              aria-pressed={displayMode === 'timeline'}
              onClick={() => setDisplayMode('timeline')}
            >
              <GanttChart />
              {t('timeline:toolbar.timeline')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={displayMode === 'tiles' ? 'primary' : 'ghost'}
              aria-pressed={displayMode === 'tiles'}
              onClick={() => setDisplayMode('tiles')}
            >
              <LayoutGrid />
              {t('timeline:toolbar.tile')}
            </Button>
          </div>
          {displayMode === 'timeline' ? (
            <>
              <div className="timeline-view-toggle" role="group" aria-label={t('timeline:toolbar.laneMode')}>
                <Button
                  type="button"
                  size="sm"
                  variant={boardView === 'split' ? 'primary' : 'ghost'}
                  aria-pressed={boardView === 'split'}
                  onClick={() => setBoardView('split')}
                >
                  <Columns2 />
                  {t('timeline:toolbar.both')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={boardView === 'tee' ? 'primary' : 'ghost'}
                  aria-pressed={boardView === 'tee'}
                  onClick={() => setBoardView('tee')}
                >
                  <CalendarRange />
                  {t('timeline:toolbar.teeSheet')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={boardView === 'caddie' ? 'primary' : 'ghost'}
                  aria-pressed={boardView === 'caddie'}
                  onClick={() => setBoardView('caddie')}
                >
                  <Users />
                  {t('timeline:toolbar.caddie')}
                </Button>
              </div>
              <div className="timeline-zoom-controls" role="group" aria-label={t('timeline:toolbar.zoom')}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('timeline:toolbar.zoomOut')}
                  disabled={pxPerHour <= MIN_PX_PER_HOUR}
                  onClick={() => nudgeZoom(-PX_PER_HOUR_STEP)}
                >
                  <ZoomOut />
                </Button>
                <button
                  type="button"
                  className="timeline-zoom-label"
                  title={t('timeline:toolbar.zoomHint')}
                  onClick={() => setPxPerHour(DEFAULT_PX_PER_HOUR)}
                >
                  {zoomPercent(pxPerHour)}%
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('timeline:toolbar.zoomIn')}
                  disabled={pxPerHour >= MAX_PX_PER_HOUR}
                  onClick={() => nudgeZoom(PX_PER_HOUR_STEP)}
                >
                  <ZoomIn />
                </Button>
              </div>
            </>
          ) : null}
          <div className="timeline-legend" aria-label={t('timeline:legend.label')}>
            <span className="timeline-legend-item coverage-assigned">{t('timeline:legend.assigned')}</span>
            <span className="timeline-legend-item coverage-unassigned">{t('timeline:legend.unassigned')}</span>
            <span className="timeline-legend-item coverage-self">{t('timeline:legend.self')}</span>
            <span className="timeline-legend-item coverage-conflict">{t('timeline:legend.conflict')}</span>
          </div>
        </section>
      </div>

      <div className="timeline-workspace" data-mode={displayMode}>
        {displayMode === 'tiles' ? (
          <TileBoard
            courseRows={courseRows}
            assignments={assignments}
            caddies={caddies}
            conflicts={conflicts}
            selectedReservationId={selectedReservation?.id ?? null}
            onSelectReservation={id => setSelection({ kind: 'reservation', id })}
            emptyAction={demoDate ? (
              <Button type="button" variant="primary" onClick={() => setDate(demoDate)}>
                {t('timeline:demo.goToDemoDate')}
              </Button>
            ) : undefined}
          />
        ) : (
        <div className="timeline-boards" data-view={boardView}>
          {boardView !== 'caddie' ? (
            <Panel
              className="timeline-panel"
              title={t('timeline:tee.title')}
              description={boardView === 'tee'
                ? t('timeline:tee.zoomedDescription')
                : t('timeline:tee.description')}
              actions={(
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={boardView === 'tee' ? t('timeline:tee.collapse') : t('timeline:tee.expand')}
                  onClick={() => setBoardView(boardView === 'tee' ? 'split' : 'tee')}
                >
                  {boardView === 'tee' ? <Minimize2 /> : <Maximize2 />}
                  {boardView === 'tee' ? t('timeline:tee.collapseLabel') : t('timeline:tee.expandLabel')}
                </Button>
              )}
            >
              {reservations.length === 0 ? (
                <EmptyState
                  title={t('timeline:tee.empty.title')}
                  description={t('timeline:tee.empty.description')}
                  action={(
                    <Button type="button" variant="primary" onClick={() => setDate(todayIsoDate())}>
                      {t('timeline:tee.empty.goToToday')}
                    </Button>
                  )}
                />
              ) : (
                <TimelineBoard
                  laneLabel={t('timeline:tee.lane')}
                  hourMarks={hourMarks}
                  nowPct={nowPct}
                  dense={boardView === 'tee'}
                  pxPerHour={pxPerHour}
                  trackWidth={trackWidth}
                  onPxPerHourChange={setPxPerHour}
                  rows={courseRows.map(row => ({
                    id: row.id,
                    label: row.name,
                    meta: row.startIntervalMinutes
                      ? t('timeline:tee.groupsWithInterval', {
                          n: String(row.items.length),
                          interval: String(row.startIntervalMinutes),
                        })
                      : t('timeline:tee.groups', { n: String(row.items.length) }),
                    teeTicks: teeTickGeometry(
                      row.startIntervalMinutes,
                      pxPerHour,
                      row.openMinutes,
                    ),
                    blocks: row.items.map(item => {
                      const coverage = coverageForReservation(item, assignments)
                      const start = parseLocalDateParts(item.teeTime).minutes
                      const block = toTimelineBlock(item.id, start, item.durationMinutes)
                      const linked = assignments.find(entry => entry.reservationId === item.id)
                      const selected = selection?.kind === 'reservation' && selection.id === item.id
                      return {
                        ...block,
                        className: [
                          'timeline-block',
                          `timeline-block-${item.playType}`,
                          coverageClass(coverage),
                          block.widthPct < 9 ? 'is-compact' : '',
                          selected ? 'is-selected' : '',
                        ].join(' '),
                        title: productDisplayName(item),
                        subtitle: t('timeline:tee.subtitle', {
                          party: item.partyName,
                          size: String(item.partySize),
                          coverage: formatCoverageLabel(coverage),
                        }),
                        tooltip: t('timeline:tee.tooltip', {
                          plan: productDisplayName(item),
                          id: productManagementNumber(item),
                          party: item.partyName,
                          number: item.reservationNumber,
                          size: String(item.partySize),
                          coverage: formatCoverageLabel(coverage),
                        }),
                        onSelect: () => setSelection({ kind: 'reservation', id: item.id }),
                        toneNote: linked?.caddieProfileId
                          ? caddies.find(profile => profile.id === linked.caddieProfileId)?.displayName
                          : coverage === 'unassigned'
                            ? t('timeline:legend.unassigned')
                            : null,
                      }
                    }),
                  }))}
                />
              )}
            </Panel>
          ) : null}

          {boardView !== 'tee' ? (
            <Panel
              className="timeline-panel"
              title={t('timeline:caddieLane.title')}
              description={boardView === 'caddie'
                ? t('timeline:caddieLane.zoomedDescription')
                : t('timeline:caddieLane.description')}
              actions={(
                <div className="timeline-panel-actions">
                  <Badge variant="neutral">
                    <Users />
                    {t('timeline:caddieLane.rosterCount', { n: String(caddies.length) })}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={boardView === 'caddie'
                      ? t('timeline:caddieLane.collapse')
                      : t('timeline:caddieLane.expand')}
                    onClick={() => setBoardView(boardView === 'caddie' ? 'split' : 'caddie')}
                  >
                    {boardView === 'caddie' ? <Minimize2 /> : <Maximize2 />}
                    {boardView === 'caddie'
                      ? t('timeline:tee.collapseLabel')
                      : t('timeline:tee.expandLabel')}
                  </Button>
                </div>
              )}
            >
              {caddies.length === 0 ? (
                <EmptyState
                  title={t('timeline:caddieLane.empty.title')}
                  description={t('timeline:caddieLane.empty.description')}
                />
              ) : (
                <TimelineBoard
                  laneLabel={t('timeline:caddieLane.lane')}
                  hourMarks={hourMarks}
                  nowPct={nowPct}
                  dense={boardView === 'caddie'}
                  pxPerHour={pxPerHour}
                  trackWidth={trackWidth}
                  onPxPerHourChange={setPxPerHour}
                  rows={caddies.map(profile => {
                    const laneAssignments = assignments
                      .filter(item => item.caddieProfileId === profile.id)
                      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
                    return {
                      id: profile.id,
                      label: profile.displayName,
                      meta: t('timeline:caddieLane.meta', {
                        rank: profile.rank,
                        skill: skillLabel(profile.skillLevel),
                      }),
                      blocks: laneAssignments.map(item => {
                        const start = parseJstDateParts(item.scheduledAt).minutes
                        const block = toTimelineBlock(item.id, start, item.durationMinutes ?? 270)
                        const reservation = reservations.find(entry => entry.id === item.reservationId)
                        const selected = selection?.kind === 'assignment' && selection.id === item.id
                        const conflicted = conflicts.has(item.id)
                        const partyLabel = reservation?.partyName ?? item.roundReference ?? item.id
                        return {
                          ...block,
                          className: [
                            'timeline-block',
                            'timeline-block-assignment',
                            conflicted ? 'is-conflict' : '',
                            block.widthPct < 9 ? 'is-compact' : '',
                            selected ? 'is-selected' : '',
                          ].join(' '),
                          title: partyLabel,
                          subtitle: `${roleLabel(item.assignmentRole)} · ${statusLabel(item.status)}`,
                          tooltip: `${partyLabel} · ${roleLabel(item.assignmentRole)} · ${statusLabel(item.status)}`,
                          onSelect: () => setSelection({ kind: 'assignment', id: item.id }),
                          toneNote: conflicted ? t('timeline:legend.conflict') : reservation?.courseName ?? null,
                        }
                      }),
                    }
                  })}
                />
              )}
            </Panel>
          ) : null}
        </div>
        )}

      </div>

      <DetailSheet
        reservation={selectedReservation}
        assignment={selectedAssignment}
        caddies={caddies}
        assignments={assignments}
        onOpenDispatch={() => navigate('golf/caddies/dispatch')}
        onClose={() => setSelection(null)}
      />
    </div>
  )
}

type CourseRow = {
  id: string
  name: string
  items: TeeReservation[]
}

function TileBoard({
  courseRows,
  assignments,
  caddies,
  conflicts,
  selectedReservationId,
  onSelectReservation,
  emptyAction,
}: {
  courseRows: CourseRow[]
  assignments: TimelineAssignment[]
  caddies: TimelineCaddie[]
  conflicts: Set<string>
  selectedReservationId: string | null
  onSelectReservation: (id: string) => void
  emptyAction: ReactNode
}) {
  const { t } = useTranslation(['timeline'])
  const total = courseRows.reduce((sum, row) => sum + row.items.length, 0)
  if (total === 0) {
    return (
      <Panel
        className="timeline-tile-panel"
        title={t('timeline:tiles.title')}
        description={t('timeline:tiles.description')}
      >
        <EmptyState
          title={t('timeline:tee.empty.title')}
          description={t('timeline:tee.empty.description')}
          action={emptyAction}
        />
      </Panel>
    )
  }

  return (
    <div className="timeline-tile-board">
      {courseRows.map(course => (
        <section key={course.id} className="timeline-tile-section" aria-label={course.name}>
          <header className="timeline-tile-section-head">
            <h2>{course.name}</h2>
            <span>{t('timeline:tiles.groups', { n: String(course.items.length) })}</span>
          </header>
          <div className="timeline-tile-grid">
            {course.items.map(item => {
              const coverage = coverageForReservation(item, assignments)
              const linked = assignments.find(entry => entry.reservationId === item.id)
              const caddie = linked
                ? caddies.find(profile => profile.id === linked.caddieProfileId)
                : null
              const conflicted = Boolean(linked && conflicts.has(linked.id))
              const selected = selectedReservationId === item.id
              const teeLabel = minutesToLabel(parseLocalDateParts(item.teeTime).minutes)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    'timeline-tile',
                    `timeline-tile-${coverage}`,
                    conflicted ? 'is-conflict' : '',
                    selected ? 'is-selected' : '',
                  ].join(' ')}
                  onClick={() => onSelectReservation(item.id)}
                >
                  <div className="timeline-tile-top">
                    <time dateTime={item.teeTime}>{teeLabel}</time>
                    <span className={coverageClass(coverage)}>
                      {conflicted ? t('timeline:legend.conflict') : formatCoverageLabel(coverage)}
                    </span>
                  </div>
                  <strong>{productDisplayName(item)}</strong>
                  <small>
                    {t('timeline:plan.meta', {
                      id: productManagementNumber(item),
                      party: item.partyName,
                    })}
                  </small>
                  <small>
                    {t('timeline:tiles.meta', {
                      size: String(item.partySize),
                      playType: playTypeLabel(item.playType),
                      holes: String(item.holes),
                    })}
                  </small>
                  <em>
                    {coverage === 'not_required'
                      ? t('timeline:tiles.caddieNotRequired')
                      : caddie?.displayName ?? t('timeline:tiles.caddieUnassigned')}
                  </em>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

type BoardRow = {
  id: string
  label: string
  meta: string
  /** Course lanes carry a tee ruler; caddie lanes have no interval of their own. */
  teeTicks?: TeeTickGeometry | null
  blocks: Array<{
    id: string
    startMinutes: number
    endMinutes: number
    leftPct: number
    widthPct: number
    className: string
    title: string
    subtitle: string
    tooltip?: string
    toneNote: string | null | undefined
    onSelect: () => void
  }>
}

function TimelineBoard({
  laneLabel,
  hourMarks,
  nowPct,
  rows,
  dense = false,
  pxPerHour,
  trackWidth,
  onPxPerHourChange,
}: {
  laneLabel: string
  hourMarks: number[]
  nowPct: number | null
  rows: BoardRow[]
  dense?: boolean
  pxPerHour: number
  trackWidth: number
  onPxPerHourChange: (value: number) => void
}) {
  const { t } = useTranslation(['timeline'])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinchRef = useRef<{ distance: number; pxPerHour: number } | null>(null)
  const pxPerHourRef = useRef(pxPerHour)
  const onZoomRef = useRef(onPxPerHourChange)
  pxPerHourRef.current = pxPerHour
  onZoomRef.current = onPxPerHourChange

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    const applyZoom = (nextPx: number, clientX: number) => {
      const previous = pxPerHourRef.current
      const clamped = clampPxPerHour(nextPx)
      if (clamped === previous) return
      const rect = scroller.getBoundingClientRect()
      const anchor = clientX - rect.left
      const contentX = scroller.scrollLeft + Math.max(anchor - LANE_WIDTH_PX, 0)
      const ratio = clamped / previous
      const nextScroll = contentX * ratio - Math.max(anchor - LANE_WIDTH_PX, 0)
      onZoomRef.current(clamped)
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, nextScroll)
      })
    }

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      applyZoom(pxPerHourRef.current + direction * PX_PER_HOUR_STEP, event.clientX)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      const a = event.touches[0]!
      const b = event.touches[1]!
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      pinchRef.current = { distance, pxPerHour: pxPerHourRef.current }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchRef.current) return
      event.preventDefault()
      const a = event.touches[0]!
      const b = event.touches[1]!
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      if (pinchRef.current.distance < 8) return
      const scale = distance / pinchRef.current.distance
      const midX = (a.clientX + b.clientX) / 2
      applyZoom(pinchRef.current.pxPerHour * scale, midX)
    }

    const onTouchEnd = () => {
      pinchRef.current = null
    }

    scroller.addEventListener('wheel', onWheel, { passive: false })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: false })
    scroller.addEventListener('touchend', onTouchEnd)
    scroller.addEventListener('touchcancel', onTouchEnd)
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const boardStyle = {
    '--timeline-track-width': `${trackWidth}px`,
    '--timeline-lane-width': `${LANE_WIDTH_PX}px`,
  } as CSSProperties

  return (
    <div
      className={`timeline-board${dense ? ' is-dense' : ''}`}
      style={boardStyle}
    >
      <div className="timeline-board-scroll" ref={scrollRef}>
        <div className="timeline-board-head">
          <div className="timeline-lane-label">{laneLabel}</div>
          <div className="timeline-track timeline-track-hours">
            {hourMarks.map(mark => {
              const isMajor = mark % 60 === 0
              return (
                <span
                  key={mark}
                  className={`timeline-hour${isMajor ? ' is-major' : ' is-minor'}`}
                  style={{
                    left: `${((mark - DEFAULT_TIMELINE_WINDOW.startMinutes)
                      / (DEFAULT_TIMELINE_WINDOW.endMinutes - DEFAULT_TIMELINE_WINDOW.startMinutes)) * 100}%`,
                  }}
                >
                  {isMajor ? minutesToLabel(mark) : minutesToLabel(mark).slice(3)}
                </span>
              )
            })}
          </div>
        </div>

        <div className="timeline-board-body">
          {rows.map((row, index) => {
            // Overlapping blocks stack into sub-rows so nothing hides behind
            // anything else — tooltips are unavailable on touch screens.
            const stacking = assignStackLanes(row.blocks)
            return (
            <div
              key={row.id}
              className="timeline-row"
              style={{
                '--timeline-row-index': index,
                '--timeline-stack-count': stacking.laneCount,
              } as CSSProperties}
            >
              <div className="timeline-lane-label" title={`${row.label} · ${row.meta}`}>
                <strong>{row.label}</strong>
                <small>{row.meta}</small>
              </div>
              <div className="timeline-track">
                <div
                  className={`timeline-gridlines${row.teeTicks ? ' has-tee-ticks' : ''}`}
                  aria-hidden="true"
                  style={row.teeTicks ? {
                    '--timeline-tee-step': `${row.teeTicks.stepPx}px`,
                    '--timeline-tee-offset': `${row.teeTicks.offsetPx}px`,
                  } as CSSProperties : undefined}
                >
                  {hourMarks.map(mark => (
                    <span
                      key={mark}
                      className={mark % 60 === 0 ? 'is-major' : 'is-minor'}
                      style={{
                        left: `${((mark - DEFAULT_TIMELINE_WINDOW.startMinutes)
                          / (DEFAULT_TIMELINE_WINDOW.endMinutes - DEFAULT_TIMELINE_WINDOW.startMinutes)) * 100}%`,
                      }}
                    />
                  ))}
                </div>
                {nowPct != null ? (
                  <div className="timeline-now" style={{ left: `${nowPct}%` }} aria-hidden="true">
                    <span>{t('timeline:now')}</span>
                  </div>
                ) : null}
                {row.blocks.map(block => (
                  <button
                    key={block.id}
                    type="button"
                    className={block.className}
                    style={{
                      left: `${block.leftPct}%`,
                      width: `${block.widthPct}%`,
                      '--timeline-stack-index': stacking.lanes.get(block.id) ?? 0,
                    } as CSSProperties}
                    onClick={block.onSelect}
                    title={block.tooltip ?? `${block.title} · ${block.subtitle}`}
                  >
                    <span className="timeline-block-copy">
                      <strong>{block.title}</strong>
                      <small>{block.subtitle}</small>
                      {block.toneNote ? <em>{block.toneNote}</em> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DetailSheet({
  reservation,
  assignment,
  caddies,
  assignments,
  onOpenDispatch,
  onClose,
}: {
  reservation: TeeReservation | null
  assignment: TimelineAssignment | null
  caddies: TimelineCaddie[]
  assignments: TimelineAssignment[]
  onOpenDispatch: () => void
  onClose: () => void
}) {
  const { t } = useTranslation(['timeline'])
  const coverage = reservation
    ? coverageForReservation(reservation, assignments)
    : 'unassigned'
  const caddie = assignment
    ? caddies.find(profile => profile.id === assignment.caddieProfileId)
    : null
  const startLabel = reservation
    ? minutesToLabel(parseLocalDateParts(reservation.teeTime).minutes)
    : assignment
      ? minutesToLabel(parseJstDateParts(assignment.scheduledAt).minutes)
      : '—'

  return (
    <Sheet
      open={Boolean(reservation || assignment)}
      onOpenChange={open => { if (!open) onClose() }}
      title={reservation
        ? productDisplayName(reservation)
        : assignment?.roundReference ?? t('timeline:detail.fallbackTitle')}
      description={reservation
        ? t('timeline:plan.reservationMeta', {
            id: productManagementNumber(reservation),
            party: reservation.partyName,
            number: reservation.reservationNumber,
          })
        : assignment?.id}
    >
      <div className="timeline-detail-card">
      <dl className="timeline-detail-list">
        <div>
          <dt>{t('timeline:detail.teeTime')}</dt>
          <dd>{startLabel}</dd>
        </div>
        <div>
          <dt>{t('timeline:detail.course')}</dt>
          <dd>{reservation?.courseName ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('timeline:detail.playType')}</dt>
          <dd>{reservation ? playTypeLabel(reservation.playType) : '—'}</dd>
        </div>
        <div>
          <dt>{t('timeline:detail.party')}</dt>
          <dd>{reservation?.partyName ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('timeline:detail.partySize')}</dt>
          <dd>
            {reservation
              ? t('timeline:detail.partySizeValue', { n: String(reservation.partySize) })
              : '—'}
          </dd>
        </div>
        <div>
          <dt>{t('timeline:detail.coverage')}</dt>
          <dd>
            <span className={coverageClass(coverage)}>{formatCoverageLabel(coverage)}</span>
          </dd>
        </div>
        <div>
          <dt>{t('timeline:detail.caddie')}</dt>
          <dd>
            {caddie?.displayName
              ?? (coverage === 'not_required'
                ? t('timeline:detail.notRequired')
                : t('timeline:detail.unassigned'))}
          </dd>
        </div>
        <div>
          <dt>{t('timeline:detail.status')}</dt>
          <dd>{statusLabel(reservation?.status ?? assignment?.status ?? '—')}</dd>
        </div>
        {reservation?.notes ? (
          <div>
            <dt>{t('timeline:detail.notes')}</dt>
            <dd>{reservation.notes}</dd>
          </div>
        ) : null}
      </dl>

      {coverage === 'unassigned' ? (
        <Notice tone="warning" title={t('timeline:detail.needsAssignment.title')}>
          {t('timeline:detail.needsAssignment.description')}
        </Notice>
      ) : null}

      {assignment && findOverlappingAssignmentIds(assignments).has(assignment.id) ? (
        <Notice tone="danger" title={t('timeline:detail.conflict.title')}>
          <span className="timeline-detail-conflict">
            <AlertTriangle />
            {t('timeline:detail.conflict.description')}
          </span>
        </Notice>
      ) : null}

      <div className="timeline-detail-actions">
        <Button type="button" variant="primary" onClick={onOpenDispatch}>
          <ClipboardCheck />
          {t('timeline:detail.openDispatch')}
        </Button>
      </div>
      </div>
    </Sheet>
  )
}
