import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Columns2,
  GanttChart,
  LayoutGrid,
  Maximize2,
  Minimize2,
  RefreshCw,
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
import { fieldApiJson } from '../../../api'
import {
  EmptyState,
  LoadingState,
  NativeSelect,
  Notice,
  PageHeader,
  Panel,
  ResourceError,
} from '../../../components/Page'
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
  minutesToLabel,
  nowLinePercent,
  parseJstDateParts,
  parseLocalDateParts,
  summarizeDay,
  toTimelineBlock,
  trackWidthPx,
  zoomPercent,
} from './timelineLayout'

const GOLF_API = '/v1/erp/extensions/golf-course'
const MOCK_NOW = '2026-07-18T09:00:00+09:00'
const LANE_WIDTH_PX = 168

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
  // Keep the demo board aligned with mock fixtures when present.
  return '2026-07-18'
}

function shiftDate(isoDate: string, deltaDays: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1, day! + deltaDays))
  return next.toISOString().slice(0, 10)
}

function statusLabel(status: string) {
  switch (status) {
    case 'confirmed':
      return '確定'
    case 'checked_in':
      return 'チェックイン済'
    case 'on_course':
      return 'プレー中'
    case 'completed':
      return '終了'
    case 'cancelled':
      return 'キャンセル'
    case 'no_show':
      return 'ノーショー'
    case 'assigned':
      return '割当済'
    case 'in_progress':
      return '進行中'
    default:
      return status.replaceAll('_', ' ')
  }
}

function playTypeLabel(playType: string) {
  switch (playType) {
    case 'caddie':
      return 'キャディ付き'
    case 'self':
      return 'セルフ'
    default:
      return playType
  }
}

function roleLabel(role: string) {
  switch (role) {
    case 'primary':
    case 'lead':
      return '主担当'
    case 'assistant':
      return '補助'
    default:
      return role
  }
}

function skillLabel(skill: string) {
  switch (skill) {
    case 'veteran':
      return 'ベテラン'
    case 'regular':
      return 'レギュラー'
    case 'junior':
      return '新人'
    default:
      return skill
  }
}

function coverageClass(coverage: AssignmentCoverage) {
  return `timeline-coverage timeline-coverage-${coverage}`
}

export function TimelinePage() {
  const [date, setDate] = useState(todayIsoDate)
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
      return fieldApiJson<TeeSheetResponse>(`${GOLF_API}/tee-sheet?${params}`)
    },
    [date, courseFilter],
  )
  const assignmentsResource = useResource(
    () => fieldApiJson<ListResponse<TimelineAssignment>>(`${GOLF_API}/caddie-assignments`),
    [],
  )
  const caddiesResource = useResource(
    () => fieldApiJson<ListResponse<TimelineCaddie>>(`${GOLF_API}/caddie-profiles`),
    [],
  )
  const coursesResource = useResource(
    () => fieldApiJson<ListResponse<{ id: string; name: string; isActive?: boolean }>>(`${GOLF_API}/courses`),
    [],
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
  const error = teeSheet.error || assignmentsResource.error || caddiesResource.error || coursesResource.error

  if (loading && !teeSheet.data) {
    return <LoadingState label="運用タイムラインを読み込み中…" />
  }
  if (error) {
    return <ResourceError error={error} onRetry={refreshAll} />
  }

  const reservations = teeSheet.data?.items ?? []
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
  const nowPct = nowLinePercent(MOCK_NOW, date)
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

  const courseRows = [...new Map(
    reservations.map(item => [item.golfCourseId, item.courseName]),
  ).entries()].map(([id, name]) => ({
    id,
    name,
    items: reservations
      .filter(item => item.golfCourseId === id)
      .sort((a, b) => a.teeTime.localeCompare(b.teeTime)),
  }))

  const conflictCount = Math.ceil(summary.conflicts / 2)
  const needsAttention = summary.unassigned > 0 || conflictCount > 0
  const attentionParts = [
    summary.unassigned > 0 ? `未割当 ${summary.unassigned}` : null,
    conflictCount > 0 ? `衝突 ${conflictCount}` : null,
  ].filter(Boolean)

  return (
    <div className="page-stack timeline-page">
      <div className="timeline-chrome">
        <PageHeader
          title="運用タイムライン"
          description={displayMode === 'tiles'
            ? '予約枠ごとのキャディ割当をタイルで確認'
            : '予約とキャディ割当を同じ時間軸で確認'}
          actions={(
            <>
              <Button type="button" variant="ghost" size="sm" onClick={refreshAll}>
                <RefreshCw />
                再読込
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={() => navigate('golf/caddies/dispatch')}>
                <ClipboardCheck />
                配置へ
              </Button>
            </>
          )}
        />

        <div
          className={`timeline-summary${needsAttention ? ' has-attention' : ''}`}
          aria-label="当日サマリー"
        >
          <div className="timeline-summary-item">
            <span>ティー数</span>
            <strong>{summary.total}</strong>
            <small>セルフ {summary.selfPlay} · キャディ {summary.caddieRequired}</small>
          </div>
          <div className="timeline-summary-item">
            <span>割当済</span>
            <strong>{summary.assigned}</strong>
            <small>充足率 {Math.round(summary.coverageRate * 100)}%</small>
          </div>
          <div className={`timeline-summary-item${summary.unassigned > 0 ? ' is-warning' : ''}`}>
            <span>未割当</span>
            <strong>{summary.unassigned}</strong>
          </div>
          <div className={`timeline-summary-item${conflictCount > 0 ? ' is-danger' : ''}`}>
            <span>衝突</span>
            <strong>{conflictCount}</strong>
          </div>
          {needsAttention ? (
            <div className="timeline-summary-attention" role="status">
              <AlertTriangle aria-hidden="true" />
              <span>配置確認 · {attentionParts.join(' · ')}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate('golf/caddies/dispatch')}>
                配置へ
              </Button>
            </div>
          ) : (
            <div className="timeline-summary-attention is-clear" role="status">
              <span>割当に問題はありません</span>
            </div>
          )}
        </div>

        <section className="timeline-toolbar" aria-label="タイムライン絞り込み">
          <div className="timeline-date-controls">
            <Button type="button" variant="ghost" size="sm" aria-label="前日" onClick={() => setDate(value => shiftDate(value, -1))}>
              <ChevronLeft />
            </Button>
            <label className="timeline-inline-field">
              <span>日付</span>
              <Input
                type="date"
                value={date}
                onChange={event => setDate(event.target.value || todayIsoDate())}
              />
            </label>
            <Button type="button" variant="ghost" size="sm" aria-label="翌日" onClick={() => setDate(value => shiftDate(value, 1))}>
              <ChevronRight />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDate(todayIsoDate())}>
              <CalendarRange />
              今日
            </Button>
          </div>
          <label className="timeline-inline-field">
            <span>コース</span>
            <NativeSelect value={courseFilter} onChange={event => setCourseFilter(event.target.value)}>
              <option value="all">すべてのコース</option>
              {courseOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </NativeSelect>
          </label>
          <div className="timeline-view-toggle" role="group" aria-label="表示モード">
            <Button
              type="button"
              size="sm"
              variant={displayMode === 'timeline' ? 'primary' : 'ghost'}
              aria-pressed={displayMode === 'timeline'}
              onClick={() => setDisplayMode('timeline')}
            >
              <GanttChart />
              タイムライン
            </Button>
            <Button
              type="button"
              size="sm"
              variant={displayMode === 'tiles' ? 'primary' : 'ghost'}
              aria-pressed={displayMode === 'tiles'}
              onClick={() => setDisplayMode('tiles')}
            >
              <LayoutGrid />
              タイル
            </Button>
          </div>
          {displayMode === 'timeline' ? (
            <>
              <div className="timeline-view-toggle" role="group" aria-label="レーン表示">
                <Button
                  type="button"
                  size="sm"
                  variant={boardView === 'split' ? 'primary' : 'ghost'}
                  aria-pressed={boardView === 'split'}
                  onClick={() => setBoardView('split')}
                >
                  <Columns2 />
                  両方
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={boardView === 'tee' ? 'primary' : 'ghost'}
                  aria-pressed={boardView === 'tee'}
                  onClick={() => setBoardView('tee')}
                >
                  <CalendarRange />
                  ティーシート
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={boardView === 'caddie' ? 'primary' : 'ghost'}
                  aria-pressed={boardView === 'caddie'}
                  onClick={() => setBoardView('caddie')}
                >
                  <Users />
                  キャディ
                </Button>
              </div>
              <div className="timeline-zoom-controls" role="group" aria-label="時間軸ズーム">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="時間軸を縮小"
                  disabled={pxPerHour <= MIN_PX_PER_HOUR}
                  onClick={() => nudgeZoom(-PX_PER_HOUR_STEP)}
                >
                  <ZoomOut />
                </Button>
                <button
                  type="button"
                  className="timeline-zoom-label"
                  title="ピンチまたは ⌘/Ctrl + スクロールでも拡大縮小できます"
                  onClick={() => setPxPerHour(DEFAULT_PX_PER_HOUR)}
                >
                  {zoomPercent(pxPerHour)}%
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="時間軸を拡大"
                  disabled={pxPerHour >= MAX_PX_PER_HOUR}
                  onClick={() => nudgeZoom(PX_PER_HOUR_STEP)}
                >
                  <ZoomIn />
                </Button>
              </div>
            </>
          ) : null}
          <div className="timeline-legend" aria-label="凡例">
            <span className="timeline-legend-item coverage-assigned">割当済</span>
            <span className="timeline-legend-item coverage-unassigned">未割当</span>
            <span className="timeline-legend-item coverage-self">セルフ</span>
            <span className="timeline-legend-item coverage-conflict">衝突</span>
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
            emptyAction={(
              <Button type="button" variant="primary" onClick={() => setDate(todayIsoDate())}>
                デモ日へ移動
              </Button>
            )}
          />
        ) : (
        <div className="timeline-boards" data-view={boardView}>
          {boardView !== 'caddie' ? (
            <Panel
              className="timeline-panel"
              title="ティーシート"
              description={boardView === 'tee'
                ? '拡大表示 · コース別レーン'
                : 'コース別レーン · ブロックの長さは想定ラウンド時間'}
              actions={(
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={boardView === 'tee' ? '分割表示に戻す' : 'ティーシートを拡大'}
                  onClick={() => setBoardView(boardView === 'tee' ? 'split' : 'tee')}
                >
                  {boardView === 'tee' ? <Minimize2 /> : <Maximize2 />}
                  {boardView === 'tee' ? '分割' : '拡大'}
                </Button>
              )}
            >
              {reservations.length === 0 ? (
                <EmptyState
                  title="この日のティーはありません"
                  description="デモ日 2026-07-18 を選ぶか、本番の Field API に接続してください。"
                  action={(
                    <Button type="button" variant="primary" onClick={() => setDate(todayIsoDate())}>
                      デモ日へ移動
                    </Button>
                  )}
                />
              ) : (
                <TimelineBoard
                  laneLabel="コース"
                  hourMarks={hourMarks}
                  nowPct={nowPct}
                  dense={boardView === 'tee'}
                  pxPerHour={pxPerHour}
                  trackWidth={trackWidth}
                  onPxPerHourChange={setPxPerHour}
                  rows={courseRows.map(row => ({
                    id: row.id,
                    label: row.name,
                    meta: `${row.items.length} 組`,
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
                        title: item.partyName,
                        subtitle: `${item.partySize}名 · ${formatCoverageLabel(coverage)}`,
                        tooltip: `${item.partyName} · ${item.reservationNumber} · ${item.partySize}名 · ${formatCoverageLabel(coverage)}`,
                        onSelect: () => setSelection({ kind: 'reservation', id: item.id }),
                        toneNote: linked?.caddieProfileId
                          ? caddies.find(profile => profile.id === linked.caddieProfileId)?.displayName
                          : coverage === 'unassigned'
                            ? '未割当'
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
              title="キャディレーン"
              description={boardView === 'caddie'
                ? '拡大表示 · キャディ別の割当バー'
                : 'キャディ別の割当バー · 赤枠は時間帯の重複'}
              actions={(
                <div className="timeline-panel-actions">
                  <Badge variant="neutral">
                    <Users />
                    名簿 {caddies.length} 名
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={boardView === 'caddie' ? '分割表示に戻す' : 'キャディレーンを拡大'}
                    onClick={() => setBoardView(boardView === 'caddie' ? 'split' : 'caddie')}
                  >
                    {boardView === 'caddie' ? <Minimize2 /> : <Maximize2 />}
                    {boardView === 'caddie' ? '分割' : '拡大'}
                  </Button>
                </div>
              )}
            >
              {caddies.length === 0 ? (
                <EmptyState title="稼働中のキャディがいません" description="先に名簿でプロフィールを登録してください。" />
              ) : (
                <TimelineBoard
                  laneLabel="キャディ"
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
                      meta: `${profile.rank}ランク · ${skillLabel(profile.skillLevel)}`,
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
                          toneNote: conflicted ? '衝突' : reservation?.courseName ?? null,
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

        <aside className="timeline-detail" aria-live="polite">
          <DetailPanel
            reservation={selectedReservation}
            assignment={selectedAssignment}
            caddies={caddies}
            assignments={assignments}
            onOpenDispatch={() => navigate('golf/caddies/dispatch')}
            onClear={() => setSelection(null)}
          />
        </aside>
      </div>
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
  const total = courseRows.reduce((sum, row) => sum + row.items.length, 0)
  if (total === 0) {
    return (
      <Panel className="timeline-tile-panel" title="予約タイル" description="予約枠ごとの割当状況">
        <EmptyState
          title="この日のティーはありません"
          description="デモ日 2026-07-18 を選ぶか、本番の Field API に接続してください。"
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
            <span>{course.items.length} 組</span>
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
                      {conflicted ? '衝突' : formatCoverageLabel(coverage)}
                    </span>
                  </div>
                  <strong>{item.partyName}</strong>
                  <small>
                    {item.partySize}名 · {playTypeLabel(item.playType)} · {item.holes}H
                  </small>
                  <em>
                    {coverage === 'not_required'
                      ? 'キャディ不要'
                      : caddie?.displayName ?? 'キャディ未割当'}
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
  blocks: Array<{
    id: string
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
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="timeline-row"
              style={{ '--timeline-row-index': index } as CSSProperties}
            >
              <div className="timeline-lane-label" title={`${row.label} · ${row.meta}`}>
                <strong>{row.label}</strong>
                <small>{row.meta}</small>
              </div>
              <div className="timeline-track">
                <div className="timeline-gridlines" aria-hidden="true">
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
                    <span>現在</span>
                  </div>
                ) : null}
                {row.blocks.map(block => (
                  <button
                    key={block.id}
                    type="button"
                    className={block.className}
                    style={{ left: `${block.leftPct}%`, width: `${block.widthPct}%` }}
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
          ))}
        </div>
      </div>
    </div>
  )
}

function DetailPanel({
  reservation,
  assignment,
  caddies,
  assignments,
  onOpenDispatch,
  onClear,
}: {
  reservation: TeeReservation | null
  assignment: TimelineAssignment | null
  caddies: TimelineCaddie[]
  assignments: TimelineAssignment[]
  onOpenDispatch: () => void
  onClear: () => void
}) {
  if (!reservation && !assignment) {
    return (
      <div className="timeline-detail-empty">
        <Clock3 />
        <strong>ブロックを選択</strong>
        <p>ティーまたはキャディバーを押すと、割当状況・衝突・次の操作を確認できます。</p>
      </div>
    )
  }

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
    <div className="timeline-detail-card">
      <div className="timeline-detail-header">
        <div>
          <div className="page-eyebrow">選択中</div>
          <h2>{reservation?.partyName ?? assignment?.roundReference ?? '割当'}</h2>
          <p>{reservation?.reservationNumber ?? assignment?.id}</p>
        </div>
        <Button type="button" variant="ghost" onClick={onClear}>クリア</Button>
      </div>

      <dl className="timeline-detail-list">
        <div>
          <dt>ティー時刻</dt>
          <dd>{startLabel}</dd>
        </div>
        <div>
          <dt>コース</dt>
          <dd>{reservation?.courseName ?? '—'}</dd>
        </div>
        <div>
          <dt>プレー区分</dt>
          <dd>{reservation ? playTypeLabel(reservation.playType) : '—'}</dd>
        </div>
        <div>
          <dt>組人数</dt>
          <dd>{reservation ? `${reservation.partySize} 名` : '—'}</dd>
        </div>
        <div>
          <dt>割当状況</dt>
          <dd>
            <span className={coverageClass(coverage)}>{formatCoverageLabel(coverage)}</span>
          </dd>
        </div>
        <div>
          <dt>キャディ</dt>
          <dd>{caddie?.displayName ?? (coverage === 'not_required' ? '不要' : '未割当')}</dd>
        </div>
        <div>
          <dt>ステータス</dt>
          <dd>{statusLabel(reservation?.status ?? assignment?.status ?? '—')}</dd>
        </div>
        {reservation?.notes ? (
          <div>
            <dt>メモ</dt>
            <dd>{reservation.notes}</dd>
          </div>
        ) : null}
      </dl>

      {coverage === 'unassigned' ? (
        <Notice tone="warning" title="割当が必要です">
          このキャディ付きティーはまだ空いています。配置画面で担当を確定してください。
        </Notice>
      ) : null}

      {assignment && findOverlappingAssignmentIds(assignments).has(assignment.id) ? (
        <Notice tone="danger" title="スケジュール衝突">
          <span className="timeline-detail-conflict">
            <AlertTriangle />
            このキャディの割当バーが別の割当と重なっています。
          </span>
        </Notice>
      ) : null}

      <div className="timeline-detail-actions">
        <Button type="button" variant="primary" onClick={onOpenDispatch}>
          <ClipboardCheck />
          配置を開く
        </Button>
      </div>
    </div>
  )
}
