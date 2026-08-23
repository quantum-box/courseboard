import { Button, Input } from '@tachyon-sdk/native-ui'
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  GanttChart,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'

import { courseboardApiJson, nowIsoMinute, today } from '../../../api'
import {
  EmptyState,
  Notice,
  Panel,
  ResourceError,
} from '../../../components/Page'
import { useResource } from '../../../hooks/useResource'
import { normalizeIsoDate } from '../../../lib/clock'
import { useRegisterPageReload } from '../../../lib/pageReload'
import { navigate, useRouteParamState } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import { caddieSupplyByCourse, type DayCaddieSupply } from '../caddieCourseSupply'
import { parseLocalDateParts } from '../timeline/timelineLayout'
import type { TeeReservation } from '../timeline/models'
import { LedgerBoard, type SlotSelection } from './LedgerBoard'
import { LedgerBoardSkeleton, SkeletonBar } from './LedgerSkeleton'
import { arrangeCourses, moveCourse } from './courseOrder'
import {
  courseIdsParam,
  courseSelectionParam,
  isCourseShown,
  normalizeCourseSelection,
  parseCourseSelection,
  pendingColumnCount,
  readStoredCourseIds,
  resolveSelection,
  toggleCourse,
  writeStoredCourseIds,
  type CourseOption,
} from './courseSelection'
import { summarizeLedger, teeTimesBetween } from './ledgerLayout'
import type { PartyDetails, SlotMarkKind, TeeLedgerResponse } from './models'
import {
  blockFixRoute,
  courseSetupRoute,
  reservationBlockReason,
  reservationTarget,
  selectedReservationTarget,
  type ReservationBlockReason,
} from './newReservation'
import {
  NewReservationEditor,
  type CreatedBooking,
  type BookablePlan,
  type NewReservationTarget,
} from './NewReservationEditor'
import { CancelReservationDialog } from './CancelReservationDialog'
import { RegisterNamesDialog } from './RegisterNamesDialog'
import { PartyEditor } from './PartyEditor'
import { SlotContextMenu, type SlotContextTarget } from './SlotContextMenu'
import { SlotMarkEditor } from './SlotMarkEditor'

const COURSE_API = '/v1/course'
/** How often the "now" row catches up with the clock. */
const NOW_TICK_MS = 30_000

type ListResponse<T> = { items: T[] }

function todayIsoDate(timezone: string) {
  return today(timezone)
}

function shiftDate(isoDate: string, deltaDays: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1, day! + deltaDays))
  return next.toISOString().slice(0, 10)
}

function useCurrentMinute(timezone: string) {
  const [now, setNow] = useState(() => nowIsoMinute(timezone))
  useEffect(() => {
    setNow(nowIsoMinute(timezone))
    const timer = setInterval(() => setNow(nowIsoMinute(timezone)), NOW_TICK_MS)
    return () => clearInterval(timer)
  }, [timezone])
  return now
}

/**
 * Previous day, the date itself, next day, and back to today.
 *
 * Shared so board-only mode keeps them: hiding the chrome is about the summary
 * and the filters, not about pinning the desk to one day.
 */
function DateControls({
  date,
  onShift,
  onSet,
  labels,
  todayDate,
}: {
  date: string
  onShift: (delta: number) => void
  onSet: (date: string) => void
  labels: { prev: string; next: string; date: string; today: string }
  todayDate: string
}) {
  return (
    <div className="ledger-date-controls">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={labels.prev}
        onClick={() => onShift(-1)}
      >
        <ChevronLeft />
      </Button>
      <label className="ledger-inline-field">
        <span>{labels.date}</span>
        <Input
          type="date"
          value={date}
          onChange={event => onSet(event.target.value || todayDate)}
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={labels.next}
        onClick={() => onShift(1)}
      >
        <ChevronRight />
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => onSet(todayDate)}>
        <CalendarRange />
        {labels.today}
      </Button>
    </div>
  )
}

export function LedgerPage() {
  const { t } = useTranslation(['ledger', 'timeline', 'common'])
  const timezone = useTenantTimezone()
  const tenantToday = todayIsoDate(timezone)
  /** In the URL: the board is a day, and a link to it has to say which one. */
  const [date, setDate] = useRouteParamState('date', {
    fallback: tenantToday,
    normalize: normalizeIsoDate,
  })
  /**
   * Also in the URL: which columns the board is showing is half of what a link
   * to it means — "the east course tomorrow" is one board, not two facts.
   *
   * Empty means every course. The stored pick is only the opening default: the
   * desk works the same columns daily, but a link that names others wins.
   */
  const [courseSelection, setCourseSelection] = useRouteParamState('courses', {
    fallback: courseSelectionParam(readStoredCourseIds()),
    normalize: normalizeCourseSelection,
  })
  const selectedCourseIds = useMemo(
    () => parseCourseSelection(courseSelection) ?? [],
    [courseSelection],
  )
  const setSelectedCourseIds = (ids: string[]) => setCourseSelection(courseSelectionParam(ids))
  const [selection, setSelection] = useState<SlotSelection | null>(null)
  const [markLabel, setMarkLabel] = useState('')
  const [savingMarks, setSavingMarks] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null)
  const [bookingTarget, setBookingTarget] = useState<NewReservationTarget | null>(null)
  /**
   * A saved booking whose names are not in the customer ledger yet.
   *
   * Kept on the page rather than in the booking sheet so the sheet can close
   * first: the booking is finished, and the question that follows is optional.
   */
  const [ledgerPrompt, setLedgerPrompt] = useState<CreatedBooking | null>(null)
  /** Hides the page chrome so the board itself fills the window. */
  const [boardOnly, setBoardOnly] = useState(false)
  const [contextTarget, setContextTarget] = useState<SlotContextTarget | null>(null)
  const [cancellingReservationId, setCancellingReservationId] = useState<string | null>(null)
  /** Parties saved this session, so the board updates without a full reload. */
  const [localParties, setLocalParties] = useState<Record<string, PartyDetails>>({})
  const currentMinute = useCurrentMinute(timezone)

  const courseIds = courseIdsParam(selectedCourseIds)
  const ledger = useResource(() => {
    const params = new URLSearchParams({ date })
    if (courseIds) params.set('golfCourseIds', courseIds)
    return courseboardApiJson<TeeLedgerResponse>(`${COURSE_API}/tee-ledger?${params}`)
  }, [date, courseIds], {
    cacheKey: `tee-ledger:${date}:${courseIds ?? 'all'}`,
  })

  const coursesResource = useResource(
    () =>
      courseboardApiJson<ListResponse<{ id: string; name: string; isActive?: boolean }>>(
        `${COURSE_API}/courses`,
      ),
    [],
    { cacheKey: 'courses:list' },
  )

  const orderResource = useResource(
    () => courseboardApiJson<{ golfCourseIds: string[] }>(`${COURSE_API}/course-order`),
    [],
    { cacheKey: 'courses:order' },
  )

  const productsResource = useResource(
    () =>
      courseboardApiJson<
        ListResponse<{
          reservationServiceId: string
          displayName?: string | null
          playType?: string | null
          expectedDurationMinutes: number
          golfCourseIds?: string[] | null
          golfCourseId?: string | null
          maxPlayersPerGroup?: number | null
        }>
      >(`${COURSE_API}/reservation-products`),
    [],
    { cacheKey: 'reservation-products:list' },
  )

  const playerTagResource = useResource(
    () => courseboardApiJson<{ items: string[] }>(`${COURSE_API}/player-tag-options`),
    [],
    { cacheKey: 'course:player-tag-options' },
  )

  /**
   * How many caddie-side groups each course can still take today.
   *
   * Not filtered by the course chips: the board draws whichever columns are
   * shown from one day-wide answer, and refetching when the desk hides a
   * column would buy nothing.
   */
  const caddieSupplyResource = useResource(
    () => courseboardApiJson<DayCaddieSupply>(
      `${COURSE_API}/caddie-course-supply?date=${encodeURIComponent(date)}`,
    ),
    [date],
    { cacheKey: `caddie-course-supply:${date}` },
  )

  const refreshAll = () => {
    ledger.refresh()
    coursesResource.refresh()
    orderResource.refresh()
    productsResource.refresh()
    playerTagResource.refresh()
    caddieSupplyResource.refresh()
  }
  useRegisterPageReload(refreshAll)

  // A selection is a set of rows on one day's board; keeping it across a date
  // change would apply the next mark to tee times the operator cannot see.
  useEffect(() => {
    setSelection(null)
  }, [date, courseIds])

  useEffect(() => {
    writeStoredCourseIds(selectedCourseIds)
  }, [selectedCourseIds])

  // Escape is the way out of every other full-screen surface, and the toolbar
  // that holds the exit button is exactly what this mode hides.
  useEffect(() => {
    if (!boardOnly) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBoardOnly(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [boardOnly])

  // The board is the slowest thing here and the toolbar does not depend on it,
  // so the page is drawn as soon as it can be and the board area alone says it
  // is still working. Blanking everything cost the desk the date controls and
  // the course filter for as long as the day took to arrive.
  const boardPending = ledger.loading && !ledger.data
  const boardFailed = Boolean(ledger.error) && !ledger.data
  const coursesLoading = coursesResource.loading && !coursesResource.data

  const rawColumns = ledger.data?.columns ?? []
  // Parties saved this session are grafted onto the fetched board so a save
  // shows up immediately without refetching the whole day.
  const columns = rawColumns.map(column => ({
    ...column,
    slots: column.slots.map(slot => ({
      ...slot,
      items: slot.items.map(item =>
        localParties[item.id] ? { ...item, party: localParties[item.id]! } : item,
      ),
    })),
  }))
  const unavailable = ledger.data?.unavailable ?? []
  const totals = summarizeLedger(columns)
  // A failed lookup leaves the map empty, which drops the caddie line from the
  // headers and leaves the rest of the board untouched. The shift board is the
  // screen that owns this number; the ledger only borrows it, so a bad day
  // upstream must not stop the desk taking bookings.
  const caddieSupply = useMemo(
    () => caddieSupplyByCourse(caddieSupplyResource.data),
    [caddieSupplyResource.data],
  )
  const courseOptions: CourseOption[] = (coursesResource.data?.items ?? [])
    .filter(course => course.isActive !== false)
    .map(course => ({ id: course.id, name: course.name }))
  // A course that was retired since the pick was stored would otherwise keep
  // narrowing the board to a column that no longer exists.
  const livePicks = resolveSelection(selectedCourseIds, courseOptions)
  const skeletonColumnCount = pendingColumnCount(selectedCourseIds, courseOptions)
  // Moving a column is computed against the whole arrangement, not just the
  // columns on screen, so filtering the board never rearranges it for others.
  const storedOrder = orderResource.data?.golfCourseIds ?? []
  const boardOrder = arrangeCourses(storedOrder, courseOptions).map(course => course.id)
  const orderedCourseOptions = arrangeCourses(storedOrder, courseOptions)

  const nowParts = parseLocalDateParts(currentMinute)
  const nowMinutes = nowParts.date === date ? nowParts.minutes : null

  const allItems: TeeReservation[] = columns.flatMap(column =>
    column.slots.flatMap(slot => slot.items),
  )
  const editingReservation = allItems.find(item => item.id === editingReservationId) ?? null
  const cancellingReservation =
    allItems.find(item => item.id === cancellingReservationId) ?? null

  const bookablePlans: BookablePlan[] = (productsResource.data?.items ?? []).map(product => ({
    reservationServiceId: product.reservationServiceId,
    label: product.displayName?.trim() || product.reservationServiceId,
    playType: product.playType === 'caddie' ? 'caddie' : 'self',
    expectedDurationMinutes: product.expectedDurationMinutes,
    golfCourseIds: product.golfCourseIds,
    golfCourseId: product.golfCourseId,
    maxPlayersPerGroup: product.maxPlayersPerGroup,
  }))
  const playerTagOptions = playerTagResource.data?.items ?? []

  const selectedBookingTarget = selectedReservationTarget(columns, selection)
  const selectedBookingBlock = selectedBookingTarget
    ? reservationBlockReason(selectedBookingTarget)
    : null
  const bookingBlockMessages: Record<ReservationBlockReason, string> = {
    full: t('ledger:newReservation.block.full'),
    stopped: t('ledger:newReservation.block.stopped'),
    missingInventory: t('ledger:newReservation.block.missingInventory'),
    missingResource: t('ledger:newReservation.block.missingResource'),
    notSellable: t('ledger:newReservation.block.notSellable'),
  }
  const selectedBookingBlockMessage = selectedBookingBlock
    ? bookingBlockMessages[selectedBookingBlock]
    : null
  const selectedBookingBlockFix = selectedBookingBlock && selectedBookingTarget
    ? blockFixRoute(selectedBookingBlock, selectedBookingTarget.column.golfCourseId)
    : null
  const bookableSelection = selectedBookingTarget && !selectedBookingBlock
    ? {
        golfCourseId: selectedBookingTarget.column.golfCourseId,
        courseName: selectedBookingTarget.column.courseName,
        teeTime: selectedBookingTarget.slot.teeTime,
        resourceId: selectedBookingTarget.column.resourceId ?? null,
      }
    : null

  const toggleSlot = (golfCourseId: string, teeTime: string, extend: boolean) => {
    setSelection(current => {
      // Selecting on a second course replaces the first: a mark is written per
      // course, and a selection spanning two of them could not be applied.
      if (!current || current.golfCourseId !== golfCourseId) {
        return { golfCourseId, teeTimes: [teeTime] }
      }
      if (extend && current.teeTimes.length > 0) {
        const column = columns.find(entry => entry.golfCourseId === golfCourseId)
        const anchor = current.teeTimes[0]!
        const range = column ? teeTimesBetween(column.slots, anchor, teeTime) : []
        return range.length > 0 ? { golfCourseId, teeTimes: range } : current
      }
      const already = current.teeTimes.includes(teeTime)
      const teeTimes = already
        ? current.teeTimes.filter(entry => entry !== teeTime)
        : [...current.teeTimes, teeTime].sort()
      return teeTimes.length > 0 ? { golfCourseId, teeTimes } : null
    })
  }

  /** Straight to the form: a caller is on the phone while this runs. */
  const bookSlot = (golfCourseId: string, teeTime: string) => {
    const target = reservationTarget(columns, golfCourseId, teeTime)
    if (!target) return
    if (reservationBlockReason(target)) {
      // The row may have changed between drawing the board and this click.
      // Keep the operator on the row and show the current reason in the sheet.
      setSelection({ golfCourseId, teeTimes: [teeTime] })
      return
    }
    setSelection(null)
    setBookingTarget({
      golfCourseId,
      courseName: target.column.courseName,
      teeTime,
      resourceId: target.column.resourceId ?? null,
    })
  }

  const moveColumn = async (golfCourseId: string, delta: -1 | 1) => {
    const visible = columns.map(column => column.golfCourseId)
    const next = moveCourse(boardOrder, visible, golfCourseId, delta)
    if (next === boardOrder) return
    setSavingOrder(true)
    try {
      await courseboardApiJson(`${COURSE_API}/course-order`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ golfCourseIds: next }),
      })
      orderResource.refresh()
      ledger.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:order.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSavingOrder(false)
    }
  }

  const applyMark = async (kind: SlotMarkKind) => {
    if (!selection) return
    setSavingMarks(true)
    try {
      await courseboardApiJson(`${COURSE_API}/slot-overrides`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          golfCourseId: selection.golfCourseId,
          date,
          teeTimes: selection.teeTimes,
          kind,
          label: markLabel.trim() || null,
        }),
      })
      showToast({ tone: 'success', message: t('ledger:marks.saved') })
      setSelection(null)
      setMarkLabel('')
      ledger.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:marks.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSavingMarks(false)
    }
  }

  const clearMarks = async () => {
    if (!selection) return
    setSavingMarks(true)
    try {
      await courseboardApiJson(`${COURSE_API}/slot-overrides`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          golfCourseId: selection.golfCourseId,
          date,
          teeTimes: selection.teeTimes,
        }),
      })
      showToast({ tone: 'success', message: t('ledger:marks.cleared') })
      setSelection(null)
      ledger.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:marks.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSavingMarks(false)
    }
  }

  return (
    <div className={`page-stack ledger-page${boardOnly ? ' is-board-only' : ''}`}>
      {ledger.error ? <ResourceError error={ledger.error} onRetry={refreshAll} /> : null}
      {unavailable.length > 0 && !boardOnly ? (
        <Notice tone="warning" title={t('ledger:partial.title')}>
          {t('ledger:partial.description')}
        </Notice>
      ) : null}

      {boardOnly ? (
        <div className="ledger-board-only-bar">
          {/* The day is what the desk changes most, so it stays reachable even
              with the rest of the chrome out of the way. */}
          <DateControls
            date={date}
            todayDate={tenantToday}
            onShift={delta => setDate(value => shiftDate(value, delta))}
            onSet={setDate}
            labels={{
              prev: t('timeline:toolbar.prevDay'),
              next: t('timeline:toolbar.nextDay'),
              date: t('timeline:toolbar.date'),
              today: t('timeline:toolbar.today'),
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setBoardOnly(false)}>
            <Minimize2 />
            {t('ledger:boardOnly.exit')}
          </Button>
        </div>
      ) : (
      <div className="ledger-chrome">
        <div className="page-toolbar">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate('golf/timeline')}
          >
            <GanttChart />
            {t('timeline:title')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setBoardOnly(true)}>
            <Maximize2 />
            {t('ledger:boardOnly.enter')}
          </Button>
        </div>

        {/* The totals are read off the board, so they wait for it — but the bar
            keeps its height rather than pushing the toolbar down when the day
            lands. */}
        <div
          className="ledger-summary"
          aria-label={t('ledger:summary.label')}
          aria-busy={boardPending || undefined}
        >
          <div className="ledger-summary-item">
            <span>{t('ledger:summary.groups')}</span>
            {boardPending ? (
              <>
                <SkeletonBar width="5ch" height={14} />
                <SkeletonBar width="14ch" />
              </>
            ) : (
              <>
                <strong>{t('ledger:summary.groupsValue', { n: String(totals.groups) })}</strong>
                <small>
                  {t('ledger:summary.breakdown', {
                    self: String(totals.selfGroups),
                    caddie: String(totals.caddieGroups),
                  })}
                </small>
              </>
            )}
          </div>
          <div className="ledger-summary-item">
            <span>{t('ledger:summary.players')}</span>
            {boardPending ? (
              <SkeletonBar width="5ch" height={14} />
            ) : (
              <strong>{t('ledger:summary.playersValue', { n: String(totals.players) })}</strong>
            )}
          </div>
          {/* The columns that cannot count say so in their own headers, so the
              day total must not quietly speak for them. With none of them
              countable there is no number to give; with some, the figure is
              real but partial and says which part it left out. */}
          <div className="ledger-summary-item">
            <span>{t('ledger:summary.open')}</span>
            {boardPending ? (
              <SkeletonBar width="5ch" height={14} />
            ) : columns.length > 0 && totals.uncountedCourses === columns.length ? (
              <strong>{t('ledger:summary.openUnknown')}</strong>
            ) : (
              <>
                <strong>{t('ledger:summary.openValue', { n: String(totals.openSlots) })}</strong>
                {totals.uncountedCourses > 0 ? (
                  <small>
                    {t('ledger:summary.openPartial', { count: totals.uncountedCourses })}
                  </small>
                ) : null}
              </>
            )}
          </div>
        </div>

        <section className="ledger-toolbar" aria-label={t('timeline:toolbar.label')}>
          <DateControls
            date={date}
            todayDate={tenantToday}
            onShift={delta => setDate(value => shiftDate(value, delta))}
            onSet={setDate}
            labels={{
              prev: t('timeline:toolbar.prevDay'),
              next: t('timeline:toolbar.nextDay'),
              date: t('timeline:toolbar.date'),
              today: t('timeline:toolbar.today'),
            }}
          />
          <fieldset className="ledger-course-picker">
            <legend>{t('ledger:courses.label')}</legend>
            <button
              type="button"
              className={`ledger-course-chip${livePicks.length === 0 ? ' is-on' : ''}`}
              aria-pressed={livePicks.length === 0}
              onClick={() => setSelectedCourseIds([])}
            >
              {t('ledger:courses.all')}
            </button>
            {orderedCourseOptions.map(course => (
              <button
                key={course.id}
                type="button"
                className={`ledger-course-chip${
                  livePicks.length > 0 && isCourseShown(livePicks, course.id) ? ' is-on' : ''
                }`}
                aria-pressed={livePicks.length > 0 && isCourseShown(livePicks, course.id)}
                onClick={() => setSelectedCourseIds(toggleCourse(livePicks, course.id))}
              >
                {course.name}
              </button>
            ))}
            {/* The course list is its own request. Standing in for the chips
                keeps the toolbar from growing a row under the date controls the
                moment they arrive. */}
            {coursesLoading
              ? Array.from({ length: skeletonColumnCount }, (_, index) => (
                  <span key={index} className="ledger-course-chip is-skeleton" aria-hidden="true">
                    <SkeletonBar width="6ch" />
                  </span>
                ))
              : null}
          </fieldset>
          <div className="ledger-legend" aria-label={t('ledger:legend.label')}>
            <span className="ledger-legend-item tone-open">{t('ledger:legend.open')}</span>
            <span className="ledger-legend-item tone-partial">{t('ledger:legend.partial')}</span>
            <span className="ledger-legend-item tone-full">{t('ledger:legend.full')}</span>
            <span className="ledger-legend-item tone-closed">{t('ledger:legend.closed')}</span>
            <span className="ledger-legend-item tone-special">{t('ledger:legend.special')}</span>
          </div>
        </section>

        <p className="ledger-mark-hint">{t('ledger:marks.selectHint')}</p>
      </div>
      )}

      <div className="ledger-workspace">
        {boardPending ? (
          // The course list is a far lighter call than the board and usually
          // lands first, so the stand-in already has the right number of
          // columns; two is what a club has when nothing is known yet.
          <LedgerBoardSkeleton columns={skeletonColumnCount} />
        ) : boardFailed ? (
          // The failure is already stated at the top of the page. Repeating it
          // here would say it twice; the empty state would say something false.
          null
        ) : columns.length === 0 ? (
          <Panel className="ledger-panel" title={t('ledger:title')} description={t('ledger:description')}>
            <EmptyState
              title={t('ledger:empty.title')}
              description={t('ledger:empty.description')}
              action={
                <Button type="button" variant="primary" onClick={() => navigate('golf/courses')}>
                  {t('ledger:empty.toSchedule')}
                </Button>
              }
            />
          </Panel>
        ) : (
          <LedgerBoard
            columns={columns}
            caddieSupply={caddieSupply}
            nowMinutes={nowMinutes}
            selection={selection}
            selectedReservationId={editingReservationId}
            onToggleSlot={toggleSlot}
            onBookSlot={bookSlot}
            onOpenContextMenu={setContextTarget}
            onSelectReservation={setEditingReservationId}
            onMoveColumn={savingOrder ? () => {} : moveColumn}
            onOpenCourseSetup={golfCourseId => navigate(courseSetupRoute(golfCourseId))}
          />
        )}
      </div>

      <SlotContextMenu
        target={contextTarget}
        onClose={() => setContextTarget(null)}
        onBook={bookSlot}
        onEditParty={setEditingReservationId}
        onCancelReservation={setCancellingReservationId}
        onSlotSettings={(golfCourseId, teeTime) =>
          setSelection({ golfCourseId, teeTimes: [teeTime] })
        }
      />

      <CancelReservationDialog
        reservation={cancellingReservation}
        onClose={() => setCancellingReservationId(null)}
        onCancelled={() => ledger.refresh()}
      />

      <SlotMarkEditor
        selection={selection}
        label={markLabel}
        saving={savingMarks}
        canBook={bookableSelection !== null}
        reservationBlockMessage={selectedBookingBlockMessage}
        onOpenBlockFix={
          selectedBookingBlockFix ? () => navigate(selectedBookingBlockFix) : null
        }
        onLabelChange={setMarkLabel}
        onClose={() => applyMark('closed')}
        onSpecial={() => applyMark('special_rate')}
        onClear={clearMarks}
        onCancel={() => setSelection(null)}
        onBook={() => {
          setBookingTarget(bookableSelection)
          setSelection(null)
        }}
      />

      <NewReservationEditor
        target={bookingTarget}
        date={date}
        plans={bookablePlans}
        plansLoading={productsResource.loading}
        playerTagOptions={playerTagOptions}
        onClose={() => setBookingTarget(null)}
        onCreated={booking => {
          void ledger.refresh()
          // Only after the sheet is gone and the booking is drawn on the board.
          // Asked over a still-open form, this reads as a step the booking is
          // waiting on rather than an optional follow-up.
          if (booking && booking.names.length > 0) setLedgerPrompt(booking)
        }}
      />

      {ledgerPrompt ? (
        <RegisterNamesDialog
          reservationId={ledgerPrompt.reservationId}
          names={ledgerPrompt.names}
          players={ledgerPrompt.players}
          onDone={() => setLedgerPrompt(null)}
        />
      ) : null}

      <PartyEditor
        reservation={editingReservation}
        plans={bookablePlans}
        playerTagOptions={playerTagOptions}
        onClose={() => setEditingReservationId(null)}
        onSaved={(reservationId, party) =>
          setLocalParties(current => ({ ...current, [reservationId]: party }))
        }
        onReservationChanged={() => ledger.refresh()}
      />
    </div>
  )
}
