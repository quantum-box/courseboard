import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@tachyon-sdk/native-ui'
import {
  CalendarCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Pin,
  Printer,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import {
  courseboardApiJson,
  currentYearMonth,
  downloadBlob,
  downloadText,
  today,
} from '../../api'
import {
  EmptyState,
  Field,
  LoadingState,
  NativeSelect,
  NativeTextarea,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary'
import { Sheet } from '../../components/Sheet'
import { YearMonthPicker, useRouteYearMonthValue } from '../../components/YearMonthPicker'
import { useResource } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import { CaddieLink } from './CaddieLink'
import {
  buildShiftRow,
  draftChangeKeys,
  monthDates,
  paddedRange,
  shiftKey,
  STREAK_WARNING_DAYS,
  withDraftShifts,
  type ConfirmedShift,
  type ShiftAssignment,
  type ShiftAvailability,
  type ShiftCell,
} from './shiftBoard'
import {
  shiftExportCsv,
  shiftExportXlsx,
  type ShiftExportDocument,
  type ShiftExportWeekend,
} from './shiftBoardExport'

const COURSE_API = '/v1/course'

type CaddieProfile = {
  id: string
  displayName: string
  employmentStatus: string
}

type ListResponse<T> = { items: T[] }

type AvailabilityDeadline = { yearMonth: string; deadlineDate: string }

type UnsubmittedCaddie = { caddieProfileId: string; displayName: string }

type GolfCourse = { id: string; name: string; shortName?: string | null }

type CaddieMembership = { golfCourseId: string; isPrimary: boolean }

/** The club's shift-planning rules. */
type ShiftRules = {
  /** Weekdays kept clear of rest days, `mon`..`sun`. */
  avoidedRestWeekdays: string[]
  maxConsecutiveWorkDays: number
  maxRoundsPerDay: number
  minRestDaysPerMonth: number
  /** `working` or `off`: how a day nobody filed for is confirmed. */
  unfiledRequest: string
  /** The statutory ceiling, so the screen can say why more is refused. */
  statutoryMaxConsecutiveWorkDays: number
  maxRoundsCeiling: number
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** What one run of the monthly plan reported back. */
type GeneratedMonth = {
  yearMonth: string
  daysWritten: number
  pinnedKept: number
  unplaced: string[]
  /** Days the run made rest days so nobody works more than six in a row. */
  statutoryRestDays: number
  /** Caddies still over that limit — only a pinned day can do it. */
  overworked: string[]
  deadlineWarning: { deadlineDate: string; unsubmittedCaddieNames: string[] } | null
}

/** One batch of a confirmed month, told to Field. */
type FieldSyncProgress = {
  /** Working days Field was told about by this call. */
  filed: number
  /** Days withdrawn from Field because they are no longer worked. */
  withdrawn: number
  /** Days whose caddie has no usable staff record, so there is nobody to file under. */
  unlinkable: number
  /** Days Field refused or could not answer for. */
  failed: number
  /** Days still behind. Call again while this is above zero. */
  remaining: number
  done: boolean
}

/** How much of a month has not reached Field. */
type FieldSyncStatus = { remaining: number }

/** A month planned but not written: what the run reported, and every day of it. */
type ShiftPlanPreview = { summary: GeneratedMonth; shifts: ConfirmedShift[] }

type ShiftPrintSource = {
  kind: 'confirmed' | 'draft'
  shifts: ConfirmedShift[]
  changedDays: Set<string> | null
}

/** The one day the desk opened for editing. */
type ShiftEditTarget = { profile: CaddieProfile; cell: ShiftCell }

// The value is a calendar date, not an instant. UTC construction keeps its
// weekday independent of the browser device timezone.
function weekdayIndex(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function weekdayLabel(date: string) {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  return i18next.t(`common:weekday.${keys[weekdayIndex(date)] ?? 'sun'}`)
}

function weekdayClassName(date: string) {
  const day = weekdayIndex(date)
  if (day === 6) return 'shift-board-weekend shift-board-saturday'
  if (day === 0) return 'shift-board-weekend shift-board-sunday'
  return undefined
}

function cellGlyph(cell: ShiftCell) {
  if (cell.kind === 'none') return ''
  return i18next.t(`shifts:cell.${cell.kind}` as 'shifts:cell.assigned')
}

function cellStateLabel(cell: ShiftCell) {
  return i18next.t(`shifts:legend.${cell.kind}` as 'shifts:legend.assigned')
}

function cellDisplay(cell: ShiftCell) {
  const glyph = cellGlyph(cell)
  return cell.assignments > 1 ? `${glyph}${cell.assignments}` : glyph
}

function employmentStatusLabel(status: string) {
  if (status === 'active') return null
  if (status === 'inactive' || status === 'suspended') {
    return i18next.t(`shifts:employment.${status}` as 'shifts:employment.inactive')
  }
  return i18next.t('shifts:employment.unknown')
}

/**
 * Whether the handed-out sheet prints anything for one day.
 *
 * The sheet answers one question — who is on the course that day — so a day
 * nobody works is left blank instead of carrying 休 (SCC-24). The screen keeps
 * showing every day as it is: that is where the desk reads who asked for what.
 *
 * Days nobody has filed for are blank for the same reason, and that is why a
 * row with nothing printed on it is dropped rather than handed round empty.
 */
function printsOnTheSheet(cell: ShiftCell) {
  return cell.kind !== 'off' && cell.kind !== 'none'
}

function exportWeekend(date: string): ShiftExportWeekend {
  const day = weekdayIndex(date)
  if (day === 6) return 'saturday'
  if (day === 0) return 'sunday'
  return null
}

function buildShiftExportDocument({
  source,
  yearMonth,
  timezone,
  dates,
  profiles,
  availabilities,
  assignments,
}: {
  source: ShiftPrintSource
  yearMonth: string
  timezone: string
  dates: string[]
  profiles: CaddieProfile[]
  availabilities: ShiftAvailability[]
  assignments: ShiftAssignment[]
}): ShiftExportDocument {
  const title = i18next.t(source.kind === 'draft'
    ? 'shifts:print.draftTitle'
    : 'shifts:print.confirmedTitle', { month: yearMonth })
  const headers = [
    i18next.t('shifts:table.caddie'),
    i18next.t('shifts:export.employment'),
    i18next.t('shifts:streak.header'),
    ...dates.map(date => `${Number(date.slice(8, 10))} ${weekdayLabel(date)}`),
  ]
  const rows = profiles
    .map(profile => ({
      profile,
      row: buildShiftRow(
        profile,
        dates,
        availabilities,
        assignments,
        source.shifts,
        timezone,
      ),
    }))
    // Nothing to print for the whole month means nothing to hand round.
    .filter(({ row }) => row.cells.some(printsOnTheSheet))
    .map(({ profile, row }) => {
      const values = row.cells.map(cell => {
        // The marks go with the day: 「固定」 or 「※変更」 alone in a square
        // would read as a state of its own.
        if (!printsOnTheSheet(cell)) return ''
        const marks = []
        if (source.changedDays?.has(shiftKey({ caddieProfileId: profile.id, date: cell.date }))) {
          marks.push(i18next.t('shifts:export.changedMark'))
        }
        if (cell.confirmed?.origin === 'pinned') marks.push(i18next.t('shifts:export.pinnedMark'))
        // The course a day was planned onto is deliberately left out: the sheet
        // is handed round as "who works when", and the two-letter course tag
        // read as part of the day's state.
        return [...marks, cellDisplay(cell)].filter(Boolean).join(' ')
      })
      return {
        values: [
          profile.displayName,
          employmentStatusLabel(row.employmentStatus) ?? i18next.t('shifts:export.active'),
          row.maxStreak > 0
            ? i18next.t('shifts:streak.days', { n: String(row.maxStreak) })
            : '—',
          ...values,
        ],
        employmentStatus: row.employmentStatus,
        // A blank square is blank in Excel too: keeping the day-off fill would
        // say 休 in colour after the mark was taken out. The weekend tint is
        // the calendar, not the shift, so it stays.
        dayStyles: row.cells.map(cell => (printsOnTheSheet(cell)
          ? {
            kind: cell.kind,
            weekend: exportWeekend(cell.date),
            longStreak: cell.inLongStreak,
            changed: source.changedDays?.has(
              shiftKey({ caddieProfileId: profile.id, date: cell.date }),
            ) ?? false,
            pinned: cell.confirmed?.origin === 'pinned',
          }
          : {
            kind: 'none',
            weekend: exportWeekend(cell.date),
            longStreak: false,
            changed: false,
            pinned: false,
          })),
      }
    })
  return {
    title,
    note: i18next.t('shifts:export.note'),
    sheetName: i18next.t(source.kind === 'draft'
      ? 'shifts:export.draftSheet'
      : 'shifts:export.confirmedSheet'),
    headers,
    headerWeekends: [null, null, null, ...dates.map(exportWeekend)],
    rows,
  }
}

export function ShiftBoardPage() {
  const { t } = useTranslation(['shifts', 'common'])
  const timezone = useTenantTimezone()
  const [currentWeekRequest, setCurrentWeekRequest] = useState(0)
  const {
    value: yearMonth,
    error: yearMonthError,
    setCandidate: setYearMonth,
  } = useRouteYearMonthValue('yearMonth', currentYearMonth(timezone))
  const dates = useMemo(() => monthDates(yearMonth), [yearMonth])
  // Availability participates in consecutive-work warnings too, so both
  // sources need the same padded range around the displayed month.
  const range = paddedRange(dates)

  const profilesResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<CaddieProfile>>(`${COURSE_API}/caddie-profiles`),
      [],
    ),
    [],
    { cacheKey: 'caddie-profiles:list' },
  )
  const availabilityResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<ShiftAvailability>>(
        `${COURSE_API}/caddie-availabilities?from=${range.from}&to=${range.to}`,
      ),
      [range.from, range.to],
    ),
    [range.from, range.to],
    { cacheKey: `caddie-availabilities:${range.from}:${range.to}` },
  )
  const assignmentsResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<ShiftAssignment>>(
        `${COURSE_API}/caddie-assignments?from=${range.from}&to=${range.to}`,
      ),
      [range.from, range.to],
    ),
    [range.from, range.to],
    { cacheKey: `caddie-assignments:${range.from}:${range.to}` },
  )
  const deadlineResource = useResource(
    useCallback(
      () => courseboardApiJson<AvailabilityDeadline | null>(
        `${COURSE_API}/caddie-availability-deadlines/${yearMonth}`,
      ),
      [yearMonth],
    ),
    [yearMonth],
    { cacheKey: `caddie-availability-deadline:${yearMonth}` },
  )
  const unsubmittedResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<UnsubmittedCaddie>>(
        `${COURSE_API}/caddie-availability-submissions/${yearMonth}`,
      ),
      [yearMonth],
    ),
    [yearMonth],
    { cacheKey: `caddie-availability-submissions:${yearMonth}` },
  )
  const shiftsResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<ConfirmedShift>>(
        `${COURSE_API}/caddie-shifts?from=${range.from}&to=${range.to}`,
      ),
      [range.from, range.to],
    ),
  )
  const coursesResource = useResource(
    useCallback(() => courseboardApiJson<ListResponse<GolfCourse>>(`${COURSE_API}/courses`), []),
  )
  const rulesResource = useResource(
    useCallback(() => courseboardApiJson<ShiftRules>(`${COURSE_API}/caddie-shift-rules`), []),
  )

  const [planning, setPlanning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [fieldSyncing, setFieldSyncing] = useState(false)
  const [fieldSyncRemaining, setFieldSyncRemaining] = useState(0)
  // Days Field refused. They are stamped as dealt with so the queue can empty,
  // which means `remaining` reaches zero with them still unsent — and the
  // re-send button, keyed on `remaining` alone, would disappear along with the
  // only way to recover them. Kept until a later pass actually sends them.
  const [fieldSyncFailed, setFieldSyncFailed] = useState(0)
  // The month the run proposed, held on screen until the desk confirms or
  // throws it away. Nothing is written while it is here.
  const [draft, setDraft] = useState<ShiftPlanPreview | null>(null)
  const [lastRun, setLastRun] = useState<GeneratedMonth | null>(null)
  const [editing, setEditing] = useState<ShiftEditTarget | null>(null)
  const [printSource, setPrintSource] = useState<ShiftPrintSource | null>(null)
  const originalPrintTitle = useRef<string | null>(null)
  // The rules are read once a month at most, so they sit behind a button
  // rather than taking a row of the toolbar on every visit.
  const [rulesOpen, setRulesOpen] = useState(false)

  const refresh = useCallback(() => {
    return Promise.all([
      profilesResource.refresh(),
      availabilityResource.refresh(),
      assignmentsResource.refresh(),
      deadlineResource.refresh(),
      unsubmittedResource.refresh(),
      shiftsResource.refresh(),
    ]).then(() => undefined)
  }, [
    profilesResource.refresh,
    availabilityResource.refresh,
    assignmentsResource.refresh,
    deadlineResource.refresh,
    unsubmittedResource.refresh,
    shiftsResource.refresh,
  ])
  useRegisterPageReload(refresh)

  // A run rewrites a month of everybody's working days, so it is planned first
  // and written second: this asks for the month the requests would produce and
  // opens it in a temporary review dialog, without touching the confirmed board.
  const planMonth = useCallback(async () => {
    setPlanning(true)
    try {
      const preview = await courseboardApiJson<ShiftPlanPreview>(
        `${COURSE_API}/caddie-shift-plans/${yearMonth}/preview`,
        { method: 'POST' },
      )
      setDraft(preview)
      setLastRun(null)
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('shifts:draft.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPlanning(false)
    }
  }, [yearMonth, t])

  // A confirmed day is also a fact Field's HRM holds — that this caddie is at
  // work, and between which times. Confirming writes CourseBoard's own tables
  // and returns at once; the roster's thousand-odd days go to Field here, a
  // batch per call, until nothing is left.
  //
  // Kept out of the confirm request on purpose: it would hold the button for
  // half a minute, and Field being unreachable would stop a club confirming a
  // month whose plan has nothing to do with Field.
  const pushMonthToField = useCallback(async (resend = false) => {
    let filed = 0
    let unlinkable = 0
    let failed = 0
    setFieldSyncFailed(0)
    try {
      // The loop stops on the server saying it is done, and also on the queue
      // failing to shrink. Trusting `done` alone means one unexpected answer
      // spins the browser forever, which is a worse failure than stopping
      // early with days still behind — those are recorded, and the re-send
      // button picks them up.
      let previous = Number.POSITIVE_INFINITY
      for (;;) {
        const progress = await courseboardApiJson<FieldSyncProgress>(
          `${COURSE_API}/caddie-shift-plans/${yearMonth}/field-sync${resend ? '?resend=true' : ''}`,
          { method: 'POST' },
        )
        filed += progress.filed ?? 0
        unlinkable += progress.unlinkable ?? 0
        failed += progress.failed ?? 0
        setFieldSyncFailed(failed)
        const remaining = Number.isFinite(progress.remaining) ? progress.remaining : 0
        setFieldSyncRemaining(remaining)
        if (progress.done || remaining === 0 || remaining >= previous) break
        previous = remaining
        // Only the first call may re-send; the rest continue the same queue.
        resend = false
      }
      if (filed > 0) {
        showToast({ tone: 'success', message: t('shifts:fieldSync.done', { n: String(filed) }) })
      }
      if (unlinkable > 0) {
        showToast({
          tone: 'warning',
          message: t('shifts:fieldSync.unlinkable', { n: String(unlinkable) }),
        })
      }
      if (failed > 0) {
        showToast({
          tone: 'danger',
          message: t('shifts:fieldSync.someFailed', { n: String(failed) }),
        })
      }
    } catch (error) {
      // The month is confirmed either way. What is left behind is days Field
      // has not been told about, and the queue remembers exactly which — so
      // this reports rather than rolls anything back.
      showToast({
        tone: 'danger',
        title: t('shifts:fieldSync.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setFieldSyncing(false)
    }
  }, [yearMonth, t])

  // Confirming re-runs the same plan against the same requests and writes it.
  // Pinned days are carried through either way, so a month confirmed twice
  // lands on the same result.
  const confirmMonth = useCallback(async () => {
    setConfirming(true)
    try {
      const run = await courseboardApiJson<GeneratedMonth>(
        `${COURSE_API}/caddie-shift-plans/${yearMonth}`,
        { method: 'POST' },
      )
      setLastRun(run)
      setDraft(null)
      shiftsResource.refresh()
      showToast({
        tone: 'success',
        message: t('shifts:confirm.done', { n: String(run.daysWritten) }),
      })
      setFieldSyncing(true)
      setFieldSyncRemaining(run.daysWritten)
      void pushMonthToField()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('shifts:confirm.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setConfirming(false)
    }
  }, [yearMonth, shiftsResource.refresh, pushMonthToField, t])

  const resendMonthToField = useCallback(() => {
    setFieldSyncing(true)
    void pushMonthToField(true)
  }, [pushMonthToField])

  // Every rule goes back in one body, so a screen that changed one field
  // never silently resets the others to their defaults.
  const saveRules = useCallback(async (next: ShiftRules) => {
    try {
      await courseboardApiJson<ShiftRules>(`${COURSE_API}/caddie-shift-rules`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          avoidedRestWeekdays: next.avoidedRestWeekdays,
          maxConsecutiveWorkDays: next.maxConsecutiveWorkDays,
          maxRoundsPerDay: next.maxRoundsPerDay,
          minRestDaysPerMonth: next.minRestDaysPerMonth,
          unfiledRequest: next.unfiledRequest,
        }),
      })
      rulesResource.refresh()
      showToast({ tone: 'success', message: t('shifts:rules.saved') })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('shifts:rules.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
      rulesResource.refresh()
    }
  }, [rulesResource.refresh, t])

  const saveDeadline = useCallback(async (deadlineDate: string) => {
    const saved = await courseboardApiJson<AvailabilityDeadline>(
      `${COURSE_API}/caddie-availability-deadlines/${yearMonth}`,
      { method: 'PUT', body: JSON.stringify({ deadlineDate }) },
    )
    deadlineResource.setData(saved)
  }, [yearMonth, deadlineResource.setData])

  // A plan belongs to the month it was made for; moving to another month
  // leaves nothing to confirm.
  useEffect(() => {
    setDraft(null)
    setLastRun(null)
    setFieldSyncRemaining(0)
    setFieldSyncFailed(0)
  }, [yearMonth])

  // A push that died half way leaves days Field was never told about, and
  // nothing else on this screen would say so. Asked once per month opened;
  // a failure here is not worth a toast, since the board still reads.
  useEffect(() => {
    let cancelled = false
    void courseboardApiJson<FieldSyncStatus>(
      `${COURSE_API}/caddie-shift-plans/${yearMonth}/field-sync`,
    )
      .then((status) => {
        if (!cancelled) setFieldSyncRemaining(status.remaining)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [yearMonth])

  const exportFileStem = useCallback((source: ShiftPrintSource) => t(
    source.kind === 'draft'
      ? 'shifts:export.draftFilename'
      : 'shifts:export.confirmedFilename',
    { month: String(Number(yearMonth.slice(5, 7))) },
  ), [t, yearMonth])

  useEffect(() => {
    const finishPrinting = () => {
      setPrintSource(null)
      if (originalPrintTitle.current !== null) {
        document.title = originalPrintTitle.current
        originalPrintTitle.current = null
      }
    }
    window.addEventListener('afterprint', finishPrinting)
    return () => {
      window.removeEventListener('afterprint', finishPrinting)
      if (originalPrintTitle.current !== null) {
        document.title = originalPrintTitle.current
        originalPrintTitle.current = null
      }
    }
  }, [])

  /**
   * The sheet this source would produce.
   *
   * Built for the print path too, even though the printable table builds its
   * own rows: a month nobody works now leaves that table empty, and the print
   * stylesheet hides the app behind it — printing would hand somebody a blank
   * page rather than say why (SCC-16 was that, from a different cause).
   */
  const buildSheet = useCallback((source: ShiftPrintSource) => buildShiftExportDocument({
    source,
    yearMonth,
    timezone,
    dates,
    profiles: profilesResource.data?.items ?? [],
    availabilities: availabilityResource.data?.items ?? [],
    assignments: assignmentsResource.data?.items ?? [],
  }), [
    yearMonth,
    timezone,
    dates,
    profilesResource.data,
    availabilityResource.data,
    assignmentsResource.data,
  ])

  const printBoard = useCallback((source: ShiftPrintSource) => {
    if (buildSheet(source).rows.length === 0) {
      showToast({ tone: 'info', message: t('shifts:export.emptyMonth') })
      return
    }
    // The printable table is rendered in a body-level portal. Flush it before
    // opening the native dialog so the browser captures all 31 days, not only
    // the horizontally visible part of the on-screen table.
    flushSync(() => setPrintSource(source))
    if (originalPrintTitle.current === null) originalPrintTitle.current = document.title
    document.title = exportFileStem(source)
    window.print()
  }, [buildSheet, exportFileStem, t])

  const exportBoard = useCallback(async (
    source: ShiftPrintSource,
    format: 'csv' | 'xlsx',
  ) => {
    try {
      const document = buildSheet(source)
      if (document.rows.length === 0) {
        showToast({ tone: 'info', message: t('shifts:export.emptyMonth') })
        return
      }
      const filename = `${exportFileStem(source)}.${format}`
      if (format === 'csv') {
        downloadText(filename, shiftExportCsv(document))
      } else {
        const bytes = await shiftExportXlsx(document)
        await downloadBlob(filename, new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }))
      }
      showToast({ tone: 'success', message: t('shifts:export.done', { format: format.toUpperCase() }) })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('shifts:export.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [buildSheet, exportFileStem, t])

  const showCurrentWeek = useCallback(() => {
    setYearMonth(today(timezone).slice(0, 7))
    setCurrentWeekRequest(request => request + 1)
  }, [setYearMonth])

  const resources = [
    profilesResource,
    availabilityResource,
    assignmentsResource,
    deadlineResource,
    unsubmittedResource,
  ]
  const refreshError = resources.find(resource => resource.error)?.error
  const loading = [profilesResource, availabilityResource, assignmentsResource]
    .some(resource => resource.loading && !resource.data)

  return (
    <div className="page-stack shift-board-page">
      <Panel>
        <div className="shift-board-toolbar flex flex-wrap items-end gap-3">
          <YearMonthPicker
            label={t('shifts:month')}
            value={yearMonth}
            error={yearMonthError}
            onChange={setYearMonth}
            currentMonth={currentYearMonth(timezone)}
            className="shift-board-month-picker"
          />
          {/* The month picker is what the desk reads; the actions sit away
              from it, against the right edge. */}
          <div className="ml-auto flex flex-wrap items-end gap-3 pb-1">
            <ShiftExportMenu
              label={t('shifts:export.action')}
              disabled={loading || (profilesResource.data?.items.length ?? 0) === 0}
              onPrint={() => printBoard({
                kind: 'confirmed',
                shifts: shiftsResource.data?.items ?? [],
                changedDays: null,
              })}
              onCsv={() => void exportBoard({
                kind: 'confirmed',
                shifts: shiftsResource.data?.items ?? [],
                changedDays: null,
              }, 'csv')}
              onExcel={() => void exportBoard({
                kind: 'confirmed',
                shifts: shiftsResource.data?.items ?? [],
                changedDays: null,
              }, 'xlsx')}
            />
            <Button type="button" variant="secondary" onClick={() => setRulesOpen(true)}>
              <SlidersHorizontal />
              {t('shifts:rules.open')}
            </Button>
            {(fieldSyncing || fieldSyncRemaining > 0 || fieldSyncFailed > 0) && (
              <Button
                type="button"
                variant="secondary"
                disabled={fieldSyncing}
                onClick={resendMonthToField}
              >
                {fieldSyncing
                  ? t('shifts:fieldSync.running', { n: String(fieldSyncRemaining) })
                  : fieldSyncRemaining > 0
                    ? t('shifts:fieldSync.resend')
                    : t('shifts:fieldSync.resendFailed', { n: String(fieldSyncFailed) })}
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              disabled={planning || confirming}
              onClick={() => void planMonth()}
            >
              <Wand2 />
              {planning ? t('shifts:draft.running') : t('shifts:draft.action')}
            </Button>
          </div>
        </div>
      </Panel>

      <RestRulesSheet
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        deadline={deadlineResource.data ?? null}
        onSaveDeadline={saveDeadline}
        rules={rulesResource.data ?? null}
        onSaveRules={saveRules}
      />

      <ShiftPlanPreviewDialog
        draft={draft}
        rules={rulesResource.data ?? null}
        confirming={confirming}
        onConfirm={() => void confirmMonth()}
        onDiscard={() => setDraft(null)}
        onPrint={source => printBoard(source)}
        onExport={(source, format) => void exportBoard(source, format)}
        yearMonth={yearMonth}
        timezone={timezone}
        dates={dates}
        profiles={profilesResource.data?.items ?? []}
        availabilities={availabilityResource.data?.items ?? []}
        assignments={assignmentsResource.data?.items ?? []}
        confirmedShifts={shiftsResource.data?.items ?? []}
        unsubmittedCaddies={unsubmittedResource.data?.items ?? []}
        loading={loading}
        error={refreshError}
        onRetry={refresh}
        currentWeekRequest={currentWeekRequest}
        onShowCurrentWeek={showCurrentWeek}
      />

      {lastRun ? (
        <ConfirmedRunNotice run={lastRun} rules={rulesResource.data ?? null} />
      ) : null}

      <SectionErrorBoundary resetKey={yearMonth}>
        <ShiftBoardResults
          yearMonth={yearMonth}
          timezone={timezone}
          dates={dates}
          profiles={profilesResource.data?.items ?? []}
          availabilities={availabilityResource.data?.items ?? []}
          assignments={assignmentsResource.data?.items ?? []}
          confirmedShifts={shiftsResource.data?.items ?? []}
          draftShifts={null}
          unsubmittedCaddies={unsubmittedResource.data?.items ?? []}
          loading={loading}
          error={refreshError}
          onRetry={refresh}
          currentWeekRequest={currentWeekRequest}
          onShowCurrentWeek={showCurrentWeek}
          onEdit={setEditing}
        />
      </SectionErrorBoundary>

      <ShiftDayEditor
        target={editing}
        courses={coursesResource.data?.items ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          shiftsResource.refresh()
        }}
      />

      <ShiftBoardPrintView
        source={printSource ?? {
          kind: 'confirmed',
          shifts: shiftsResource.data?.items ?? [],
          changedDays: null,
        }}
        yearMonth={yearMonth}
        timezone={timezone}
        dates={dates}
        profiles={profilesResource.data?.items ?? []}
        availabilities={availabilityResource.data?.items ?? []}
        assignments={assignmentsResource.data?.items ?? []}
      />
    </div>
  )
}

/** Whether a run is worth reading twice: somebody is unplaced or over the limit. */
function runNeedsAttention(run: GeneratedMonth) {
  return run.unplaced.length > 0 || run.overworked.length > 0 || Boolean(run.deadlineWarning)
}

/** What a run did to the month, said the same way whether it was written or not. */
function RunSummaryLines({ run, rules }: { run: GeneratedMonth; rules: ShiftRules | null }) {
  const { t } = useTranslation(['shifts'])
  const limit = String(rules?.maxConsecutiveWorkDays ?? 6)
  return (
    <>
      {run.statutoryRestDays > 0 ? (
        <p>
          {t('shifts:confirm.statutoryRest', {
            n: String(run.statutoryRestDays),
            limit,
          })}
        </p>
      ) : null}
      {run.overworked.length > 0 ? (
        <p>
          {t('shifts:confirm.overworked', {
            names: run.overworked.join('、'),
            limit,
          })}
        </p>
      ) : null}
      {run.unplaced.length > 0 ? (
        <p>{t('shifts:confirm.unplaced', { names: run.unplaced.join('、') })}</p>
      ) : null}
      {run.deadlineWarning ? (
        <p>
          {t('shifts:confirm.unsubmitted', {
            names: run.deadlineWarning.unsubmittedCaddieNames.join('、'),
          })}
        </p>
      ) : null}
    </>
  )
}

/**
 * The month the run proposed, waiting to be confirmed.
 *
 * The confirmed table stays mounted behind this dialog and is deliberately
 * not given the proposed shifts. Closing the dialog is the same as throwing
 * the plan away; while the confirm request is in flight, the controlled
 * dialog ignores every close request so the operator cannot lose that state.
 */
function ShiftPlanPreviewDialog({
  draft,
  rules,
  confirming,
  onConfirm,
  onDiscard,
  onPrint,
  onExport,
  yearMonth,
  timezone,
  dates,
  profiles,
  availabilities,
  assignments,
  confirmedShifts,
  unsubmittedCaddies,
  loading,
  error,
  onRetry,
  currentWeekRequest,
  onShowCurrentWeek,
}: {
  draft: ShiftPlanPreview | null
  rules: ShiftRules | null
  confirming: boolean
  onConfirm: () => void
  onDiscard: () => void
  onPrint: (source: ShiftPrintSource) => void
  onExport: (source: ShiftPrintSource, format: 'csv' | 'xlsx') => void
  yearMonth: string
  timezone: string
  dates: string[]
  profiles: CaddieProfile[]
  availabilities: ShiftAvailability[]
  assignments: ShiftAssignment[]
  confirmedShifts: ConfirmedShift[]
  unsubmittedCaddies: UnsubmittedCaddie[]
  loading: boolean
  error: unknown
  onRetry: () => void
  currentWeekRequest: number
  onShowCurrentWeek: () => void
}) {
  const { t } = useTranslation(['shifts'])

  const changedDates = useMemo(() => {
    if (!draft) return new Set<string>()
    const dates = new Set<string>()
    for (const key of draftChangeKeys(confirmedShifts, draft.shifts)) {
      const separator = key.indexOf(':')
      if (separator >= 0) dates.add(key.slice(separator + 1))
    }
    return dates
  }, [confirmedShifts, draft])

  if (!draft) return null
  const run = draft.summary
  const draftSource: ShiftPrintSource = {
    kind: 'draft',
    shifts: withDraftShifts(confirmedShifts, draft.shifts),
    changedDays: draftChangeKeys(confirmedShifts, draft.shifts),
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !confirming) onDiscard()
      }}
    >
      <DialogContent className="shift-board-preview-dialog flex flex-col overflow-hidden">
        <DialogHeader className="flex-none">
          <DialogTitle>{t('shifts:draft.dialogTitle', { month: run.yearMonth })}</DialogTitle>
          <DialogDescription>{t('shifts:draft.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="shift-board-preview-dialog-body min-h-0 flex-1 space-y-4 overflow-y-auto">
          <Notice
            tone={runNeedsAttention(run) ? 'warning' : 'info'}
            title={t('shifts:draft.summaryTitle')}
          >
            <p>
              {t('shifts:draft.noticeBody', {
                n: String(run.daysWritten),
                pinned: String(run.pinnedKept),
              })}
            </p>
            <p>{t('shifts:draft.changedDays', { n: String(changedDates.size) })}</p>
            <RunSummaryLines run={run} rules={rules} />
            <p className="text-muted-foreground">{t('shifts:draft.readOnly')}</p>
          </Notice>

          <ShiftBoardResults
            yearMonth={yearMonth}
            timezone={timezone}
            dates={dates}
            profiles={profiles}
            availabilities={availabilities}
            assignments={assignments}
            confirmedShifts={confirmedShifts}
            draftShifts={draft.shifts}
            unsubmittedCaddies={unsubmittedCaddies}
            loading={loading}
            error={error}
            onRetry={onRetry}
            currentWeekRequest={currentWeekRequest}
            onShowCurrentWeek={onShowCurrentWeek}
            onEdit={() => undefined}
          />
        </div>

        <DialogFooter className="flex-none border-t border-border pt-4">
          <ShiftExportMenu
            label={t('shifts:export.draftAction')}
            disabled={confirming}
            onPrint={() => onPrint(draftSource)}
            onCsv={() => onExport(draftSource, 'csv')}
            onExcel={() => onExport(draftSource, 'xlsx')}
          />
          <Button type="button" variant="secondary" disabled={confirming} onClick={onDiscard}>
            {t('shifts:draft.discard')}
          </Button>
          <Button type="button" variant="primary" disabled={confirming} onClick={onConfirm}>
            <CalendarCheck />
            {confirming ? t('shifts:confirm.running') : t('shifts:draft.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShiftExportMenu({
  label,
  disabled,
  onPrint,
  onCsv,
  onExcel,
}: {
  label: string
  disabled: boolean
  onPrint: () => void
  onCsv: () => void
  onExcel: () => void
}) {
  const { t } = useTranslation(['shifts'])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" disabled={disabled}>
          <Download />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onPrint}>
          <Printer />
          {t('shifts:export.pdfPrint')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCsv}>
          <FileText />
          {t('shifts:export.csv')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExcel}>
          <FileSpreadsheet />
          {t('shifts:export.excel')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A print-only monthly board.
 *
 * The interactive board is horizontally scrollable and therefore unsuitable
 * as a print source. This body-level portal lays out the complete month on one
 * A3 landscape page, which the native dialog can send to a printer or save as
 * PDF without changing any shift data.
 */
function ShiftBoardPrintView({
  source,
  yearMonth,
  timezone,
  dates,
  profiles,
  availabilities,
  assignments,
}: {
  source: ShiftPrintSource | null
  yearMonth: string
  timezone: string
  dates: string[]
  profiles: CaddieProfile[]
  availabilities: ShiftAvailability[]
  assignments: ShiftAssignment[]
}) {
  const { t } = useTranslation(['shifts'])
  const rows = useMemo(() => {
    if (!source) return []
    return profiles
      .map(profile => ({
        profile,
        row: buildShiftRow(
          profile,
          dates,
          availabilities,
          assignments,
          source.shifts,
          timezone,
        ),
      }))
      // Same sheet, same rule as the CSV and the workbook.
      .filter(({ row }) => row.cells.some(printsOnTheSheet))
  }, [source, profiles, dates, availabilities, assignments, timezone])

  if (!source || rows.length === 0 || typeof document === 'undefined') return null

  return createPortal(
    <section
      className="shift-board-print"
      data-print-source={source.kind}
      aria-label={t('shifts:print.aria', { month: yearMonth })}
    >
      <header className="shift-board-print-header">
        <div>
          <p className="shift-board-print-brand">CourseBoard</p>
          <h1>
            {t(source.kind === 'draft'
              ? 'shifts:print.draftTitle'
              : 'shifts:print.confirmedTitle', { month: yearMonth })}
          </h1>
        </div>
        <p>{t('shifts:print.pageNote')}</p>
      </header>

      <div className="shift-board-print-legend" aria-label={t('shifts:legend.label')}>
        <span><i data-kind="assigned" /> {t('shifts:legend.assigned')}</span>
        <span><i data-kind="available" /> {t('shifts:legend.available')}</span>
        <span><i data-kind="morning" /> {t('shifts:legend.morning')}</span>
        <span><i data-kind="afternoon" /> {t('shifts:legend.afternoon')}</span>
        <span><i data-kind="light" /> {t('shifts:legend.light')}</span>
        <span><i data-kind="unknown" /> {t('shifts:legend.unknown')}</span>
        <span><i data-pinned="true" /> {t('shifts:legend.pinned')}</span>
        {source.kind === 'draft' ? (
          <span><i data-draft-change="true" /> {t('shifts:draft.legendChanged')}</span>
        ) : null}
      </div>

      <table aria-label={t('shifts:print.aria', { month: yearMonth })}>
        <thead>
          <tr>
            <th scope="col" className="shift-board-print-name">{t('shifts:table.caddie')}</th>
            <th scope="col" className="shift-board-print-streak">{t('shifts:streak.header')}</th>
            {dates.map(date => (
              <th key={date} scope="col" className={weekdayClassName(date)}>
                <span>{Number(date.slice(8, 10))}</span>
                <small>{weekdayLabel(date)}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ profile, row }) => (
            <tr key={profile.id} data-employment-status={row.employmentStatus}>
              <th scope="row" className="shift-board-print-name">
                {profile.displayName}
              </th>
              <td
                className="shift-board-print-streak"
                data-long-streak={row.maxStreak >= STREAK_WARNING_DAYS || undefined}
              >
                {row.maxStreak > 0
                  ? t('shifts:streak.days', { n: String(row.maxStreak) })
                  : '—'}
              </td>
              {row.cells.map(cell => {
                const printed = printsOnTheSheet(cell)
                return (
                  <td
                    key={cell.date}
                    data-kind={printed ? cell.kind : 'none'}
                    data-long-streak={(printed && cell.inLongStreak) || undefined}
                    data-pinned={(printed && cell.confirmed?.origin === 'pinned') || undefined}
                    data-draft-change={(printed && source.changedDays?.has(
                      shiftKey({ caddieProfileId: profile.id, date: cell.date }),
                    )) || undefined}
                    className={weekdayClassName(cell.date)}
                  >
                    <span className="shift-board-print-mark">
                      {printed ? cellDisplay(cell) : ''}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>,
    document.body,
  )
}

/** What the last run of the month did, kept on screen until the next one. */
function ConfirmedRunNotice({
  run,
  rules,
}: {
  run: GeneratedMonth
  rules: ShiftRules | null
}) {
  const { t } = useTranslation(['shifts'])
  return (
    <Notice
      tone={runNeedsAttention(run) ? 'warning' : 'info'}
      title={t('shifts:confirm.noticeTitle', { month: run.yearMonth })}
    >
      <p>
        {t('shifts:confirm.noticeBody', {
          n: String(run.daysWritten),
          pinned: String(run.pinnedKept),
        })}
      </p>
      <RunSummaryLines run={run} rules={rules} />
    </Notice>
  )
}

function DeadlineEditor({
  deadline,
  onSave,
}: {
  deadline: AvailabilityDeadline | null
  onSave: (deadlineDate: string) => Promise<void>
}) {
  const { t } = useTranslation(['shifts', 'common'])
  const [value, setValue] = useState(deadline?.deadlineDate ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(deadline?.deadlineDate ?? '')
  }, [deadline?.deadlineDate])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!value || saving) return
    setSaving(true)
    try {
      await onSave(value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="shift-board-deadline flex items-end gap-2 pb-1" onSubmit={submit}>
      <label className="shift-board-deadline-field flex flex-col gap-1">
        <span className="text-muted-foreground">{t('shifts:deadline.label')}</span>
        <input
          type="date"
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      </label>
      <Button type="submit" variant="secondary" disabled={saving || !value}>
        {t('shifts:deadline.save')}
      </Button>
    </form>
  )
}

/**
 * The two settings a month is planned against: when requests are due, and
 * which weekdays to keep clear of rest days.
 *
 * Both are set once a month at most, so they live behind a button rather than
 * taking up the toolbar of a screen the desk opens every day.
 */
function RestRulesSheet({
  open,
  onClose,
  deadline,
  onSaveDeadline,
  rules,
  onSaveRules,
}: {
  open: boolean
  onClose: () => void
  deadline: AvailabilityDeadline | null
  onSaveDeadline: (deadlineDate: string) => Promise<void>
  rules: ShiftRules | null
  onSaveRules: (rules: ShiftRules) => Promise<void>
}) {
  const { t } = useTranslation(['shifts', 'common'])
  const [saving, setSaving] = useState(false)

  async function change(patch: Partial<ShiftRules>) {
    if (!rules || saving) return
    setSaving(true)
    try {
      await onSaveRules({ ...rules, ...patch })
    } finally {
      setSaving(false)
    }
  }

  const consecutiveChoices = Array.from(
    { length: rules?.statutoryMaxConsecutiveWorkDays ?? 6 },
    (_, index) => index + 1,
  )
  const roundChoices = Array.from({ length: rules?.maxRoundsCeiling ?? 2 }, (_, i) => i + 1)

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
      title={t('shifts:rules.sheetTitle')}
      description={t('shifts:rules.sheetDescription')}
    >
      <fieldset className="shift-rules-sheet space-y-5" disabled={!rules || saving}>
        <DeadlineEditor deadline={deadline} onSave={onSaveDeadline} />

        <Field
          label={t('shifts:rules.maxConsecutive')}
          requirement="none"
          hint={t('shifts:rules.maxConsecutiveHint', {
            n: String(rules?.statutoryMaxConsecutiveWorkDays ?? 6),
          })}
        >
          <NativeSelect
            value={String(rules?.maxConsecutiveWorkDays ?? 6)}
            onChange={event => void change({ maxConsecutiveWorkDays: Number(event.target.value) })}
          >
            {consecutiveChoices.map(days => (
              <option key={days} value={days}>{t('shifts:rules.days', { n: String(days) })}</option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label={t('shifts:rules.maxRounds')}
          requirement="none"
          hint={t('shifts:rules.maxRoundsHint')}
        >
          <NativeSelect
            value={String(rules?.maxRoundsPerDay ?? 2)}
            onChange={event => void change({ maxRoundsPerDay: Number(event.target.value) })}
          >
            {roundChoices.map(rounds => (
              <option key={rounds} value={rounds}>
                {t('shifts:rules.rounds', { n: String(rounds) })}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label={t('shifts:rules.minRest')}
          requirement="none"
          hint={t('shifts:rules.minRestHint')}
        >
          <NativeSelect
            value={String(rules?.minRestDaysPerMonth ?? 0)}
            onChange={event => void change({ minRestDaysPerMonth: Number(event.target.value) })}
          >
            <option value="0">{t('shifts:rules.minRestNone')}</option>
            {Array.from({ length: 12 }, (_, index) => index + 4).map(days => (
              <option key={days} value={days}>{t('shifts:rules.days', { n: String(days) })}</option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label={t('shifts:rules.unfiled')}
          requirement="none"
          hint={t('shifts:rules.unfiledHint')}
        >
          <NativeSelect
            value={rules?.unfiledRequest ?? 'working'}
            onChange={event => void change({ unfiledRequest: event.target.value })}
          >
            <option value="working">{t('shifts:rules.unfiledWorking')}</option>
            <option value="off">{t('shifts:rules.unfiledOff')}</option>
          </NativeSelect>
        </Field>

        <AvoidedWeekdaysEditor
          rules={rules}
          onSave={weekdays => change({ avoidedRestWeekdays: weekdays })}
        />

        <p className="text-muted-foreground">{t('shifts:streak.threshold')}</p>
      </fieldset>
    </Sheet>
  )
}

/**
 * Which weekdays the club keeps clear of rest days.
 *
 * A Saturday short of caddies costs more than a Tuesday, but which days those
 * are is the club's own: some fill on Saturday and are quiet on Sunday. The
 * plan treats these as a preference — when the six-day limit leaves nothing
 * else in the window, a protected day is used anyway.
 */
function AvoidedWeekdaysEditor({
  rules,
  onSave,
}: {
  rules: ShiftRules | null
  onSave: (weekdays: string[]) => Promise<void> | void
}) {
  const { t } = useTranslation(['shifts', 'common'])

  function toggle(weekday: string, avoided: boolean) {
    if (!rules) return
    const next = avoided
      ? WEEK.filter(day => day === weekday || rules.avoidedRestWeekdays.includes(day))
      : rules.avoidedRestWeekdays.filter(day => day !== weekday)
    void onSave([...next])
  }

  return (
    <fieldset className="shift-board-rest-rule pb-1">
      <legend className="text-muted-foreground">{t('shifts:rules.avoidLabel')}</legend>
      <div className="shift-board-weekday-toggles">
        {WEEK.map(weekday => {
          const avoided = rules?.avoidedRestWeekdays.includes(weekday) ?? false
          return (
            <label key={weekday} className="shift-board-weekday-toggle">
              <input
                type="checkbox"
                checked={avoided}
                onChange={event => toggle(weekday, event.target.checked)}
              />
              <span>{t(`common:weekday.${weekday}` as 'common:weekday.mon')}</span>
            </label>
          )
        })}
      </div>
      <p className="shift-board-rest-rule-hint text-muted-foreground">
        {t('shifts:rules.avoidHint')}
      </p>
    </fieldset>
  )
}

function ShiftBoardResults({
  yearMonth,
  timezone,
  dates,
  profiles,
  availabilities,
  assignments,
  confirmedShifts,
  draftShifts,
  unsubmittedCaddies,
  loading,
  error,
  onRetry,
  currentWeekRequest,
  onShowCurrentWeek,
  onEdit,
}: {
  yearMonth: string
  timezone: string
  dates: string[]
  profiles: CaddieProfile[]
  availabilities: ShiftAvailability[]
  assignments: ShiftAssignment[]
  confirmedShifts: ConfirmedShift[]
  /** A proposed month, used only by the read-only preview dialog. */
  draftShifts: ConfirmedShift[] | null
  unsubmittedCaddies: UnsubmittedCaddie[]
  loading: boolean
  error: unknown
  onRetry: () => void
  currentWeekRequest: number
  onShowCurrentWeek: () => void
  onEdit: (target: ShiftEditTarget) => void
}) {
  const { t } = useTranslation(['shifts', 'common'])
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canScrollBack, setCanScrollBack] = useState(false)
  const [canScrollForward, setCanScrollForward] = useState(false)
  // The normal page passes null here and therefore always draws confirmed
  // shifts. The preview dialog passes the proposal to this same renderer so
  // the difference is visible without changing the underlying board.
  const shownShifts = useMemo(
    () => (draftShifts ? withDraftShifts(confirmedShifts, draftShifts) : confirmedShifts),
    [confirmedShifts, draftShifts],
  )
  const changedDays = useMemo(
    () => (draftShifts ? draftChangeKeys(confirmedShifts, draftShifts) : null),
    [confirmedShifts, draftShifts],
  )
  const rows = useMemo(() => profiles.map(profile => ({
    profile,
    row: buildShiftRow(
      profile,
      dates,
      availabilities,
      assignments,
      shownShifts,
      timezone,
    ),
  })), [profiles, dates, availabilities, assignments, shownShifts, timezone])
  const longStreakNames = rows
    .filter(entry => entry.row.maxStreak >= STREAK_WARNING_DAYS)
    .map(entry => entry.profile.displayName)
  const hasAnyPlan = rows.some(entry => entry.row.cells.some(cell => cell.kind !== 'none'))

  const updateScrollButtons = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const lastScrollLeft = Math.max(0, scroller.scrollWidth - scroller.offsetWidth)
    setCanScrollBack(scroller.scrollLeft > 1)
    setCanScrollForward(scroller.scrollLeft < lastScrollLeft - 1)
  }, [])

  const scrollByWeek = useCallback((direction: -1 | 1) => {
    const scroller = scrollerRef.current
    const firstDay = scroller?.querySelector<HTMLElement>('[data-shift-date]')
    if (!scroller || !firstDay) return
    const dayWidth = firstDay.getBoundingClientRect().width
    scroller.scrollBy({ left: direction * dayWidth * 7, behavior: 'smooth' })
  }, [])

  const scrollToDate = useCallback((date: string) => {
    const scroller = scrollerRef.current
    const target = scroller?.querySelector<HTMLElement>(`[data-shift-date="${date}"]`)
    if (!scroller || !target) return
    const name = scroller.querySelector<HTMLElement>('thead .shift-board-name')
    const streak = scroller.querySelector<HTMLElement>('thead .shift-board-streak')
    const pinnedWidth = (name?.getBoundingClientRect().width ?? 0)
      + (streak?.getBoundingClientRect().width ?? 0)
    const scrollerRect = scroller.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const visibleLeft = scrollerRect.left + pinnedWidth
    if (targetRect.left >= visibleLeft && targetRect.right <= scrollerRect.right) return
    scroller.scrollTo({
      left: Math.max(0, target.offsetLeft - pinnedWidth),
      behavior: 'smooth',
    })
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return undefined
    updateScrollButtons()
    scroller.addEventListener('scroll', updateScrollButtons, { passive: true })
    window.addEventListener('resize', updateScrollButtons)
    return () => {
      scroller.removeEventListener('scroll', updateScrollButtons)
      window.removeEventListener('resize', updateScrollButtons)
    }
  }, [dates.length, rows.length, updateScrollButtons])

  useEffect(() => {
    if (currentWeekRequest === 0) return undefined
    const frame = window.requestAnimationFrame(() => scrollToDate(today(timezone)))
    return () => window.cancelAnimationFrame(frame)
  }, [currentWeekRequest, dates, scrollToDate])

  return (
    <>
      {unsubmittedCaddies.length > 0 ? (
        <Notice tone="warning" title={t('shifts:unsubmitted.title')}>
          {t('shifts:unsubmitted.body', {
            names: unsubmittedCaddies.map(caddie => caddie.displayName).join('、'),
          })}
        </Notice>
      ) : null}

      {longStreakNames.length > 0 ? (
        <Notice tone="warning" title={t('shifts:streak.warningTitle')}>
          {t('shifts:streak.warningBody', {
            names: longStreakNames.join('、'),
            n: String(STREAK_WARNING_DAYS),
          })}
        </Notice>
      ) : null}

      {loading && rows.length === 0 ? <LoadingState label={t('shifts:loading')} /> : null}
      {error ? <ResourceError error={error} onRetry={onRetry} /> : null}

      {rows.length > 0 ? (
        <Panel>
          {!hasAnyPlan ? (
            <EmptyState title={t('shifts:empty.title')} description={t('shifts:empty.description')} />
          ) : null}
          <div className="shift-board-tools">
            <div className="shift-board-legend" aria-label={t('shifts:legend.label')}>
              <span><i data-kind="assigned" /> {t('shifts:legend.assigned')}</span>
              <span><i data-kind="available" /> {t('shifts:legend.available')}</span>
              <span><i data-kind="off" /> {t('shifts:legend.off')}</span>
              <span><i data-kind="morning" /> {t('shifts:legend.morning')}</span>
              <span><i data-kind="afternoon" /> {t('shifts:legend.afternoon')}</span>
              <span><i data-kind="light" /> {t('shifts:legend.light')}</span>
              <span><i data-kind="unknown" /> {t('shifts:legend.unknown')}</span>
              <span><i data-long-streak="true" /> {t('shifts:streak.warningTitle')}</span>
              <span><i data-pinned="true" /> {t('shifts:legend.pinned')}</span>
              {draftShifts ? (
                <span><i data-draft-change="true" /> {t('shifts:draft.legendChanged')}</span>
              ) : null}
            </div>
            <div className="shift-board-navigation" aria-label={t('shifts:navigation.label')}>
              <Button
                type="button"
                variant="secondary"
                disabled={!canScrollBack}
                onClick={() => scrollByWeek(-1)}
              >
                {t('shifts:navigation.previous')}
              </Button>
              <Button type="button" variant="secondary" onClick={onShowCurrentWeek}>
                {t('shifts:navigation.current')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canScrollForward}
                onClick={() => scrollByWeek(1)}
              >
                {t('shifts:navigation.next')}
              </Button>
            </div>
          </div>
          <div
            ref={scrollerRef}
            className="shift-board-scroll"
            role="region"
            aria-label={t('shifts:table.aria', { month: yearMonth })}
            tabIndex={0}
          >
            <table className="shift-board" aria-label={t('shifts:table.aria', { month: yearMonth })}>
              <thead>
                <tr>
                  <th scope="col" className="shift-board-name">{t('shifts:table.caddie')}</th>
                  <th scope="col" className="shift-board-streak">{t('shifts:streak.header')}</th>
                  {dates.map(date => (
                    <th
                      key={date}
                      scope="col"
                      data-shift-date={date}
                      className={weekdayClassName(date)}
                    >
                      <span className="shift-board-day">{Number(date.slice(8, 10))}</span>
                      <span className="shift-board-dow">{weekdayLabel(date)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ profile, row }) => {
                  const statusLabel = employmentStatusLabel(row.employmentStatus)
                  return (
                    <tr key={profile.id} data-employment-status={row.employmentStatus}>
                      <th scope="row" className="shift-board-name">
                        <span className="shift-board-profile">
                          <span className="shift-board-profile-name">
                            <CaddieLink caddieId={profile.id} displayName={profile.displayName} />
                          </span>
                          {statusLabel ? (
                            <span className="shift-board-profile-status sr-only">
                              {statusLabel}
                            </span>
                          ) : null}
                        </span>
                      </th>
                      <td
                        className={`shift-board-streak ${
                          row.maxStreak >= STREAK_WARNING_DAYS ? 'shift-board-streak-warning' : ''
                        }`}
                      >
                        {row.maxStreak > 0 ? t('shifts:streak.days', { n: String(row.maxStreak) }) : '—'}
                      </td>
                      {row.cells.map(cell => (
                        <td
                          key={cell.date}
                          data-kind={cell.kind}
                          data-long-streak={cell.inLongStreak || undefined}
                          data-pinned={cell.confirmed?.origin === 'pinned' || undefined}
                          data-draft-change={changedDays?.has(
                            shiftKey({ caddieProfileId: profile.id, date: cell.date }),
                          ) || undefined}
                          className={weekdayClassName(cell.date)}
                        >
                          <button
                            type="button"
                            className="shift-board-cell-button"
                            disabled={draftShifts !== null}
                            aria-label={cell.assignments > 1
                              ? t('shifts:cell.ariaWithAssignments', {
                                  name: profile.displayName,
                                  date: cell.date,
                                  state: cellStateLabel(cell),
                                  n: String(cell.assignments),
                                })
                              : t('shifts:cell.aria', {
                                  name: profile.displayName,
                                  date: cell.date,
                                  state: cellStateLabel(cell),
                                })}
                            onClick={() => onEdit({ profile, cell })}
                          >
                            <span className="shift-board-mark" aria-hidden="true">
                              {cellDisplay(cell)}
                            </span>
                          </button>
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  )
}

/**
 * One confirmed day, changed by hand.
 *
 * The courses on offer are the caddie's own memberships, main and sub: a sub
 * membership is exactly the permission to be sent there when that course runs
 * short, and anything else the API would refuse anyway.
 */
function ShiftDayEditor({
  target,
  courses,
  onClose,
  onSaved,
}: {
  target: ShiftEditTarget | null
  courses: GolfCourse[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['shifts', 'common'])
  const [isWorking, setIsWorking] = useState(true)
  const [span, setSpan] = useState('full_day')
  const [rounds, setRounds] = useState(1)
  const [courseId, setCourseId] = useState('')
  const [pinned, setPinned] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const profileId = target?.profile.id ?? null
  const memberships = useResource(
    useCallback(() => {
      if (!profileId) return Promise.resolve({ items: [] as CaddieMembership[] })
      return courseboardApiJson<ListResponse<CaddieMembership>>(
        `${COURSE_API}/caddie-profiles/${encodeURIComponent(profileId)}/courses`,
      )
    }, [profileId]),
    [profileId],
    { enabled: profileId !== null },
  )

  useEffect(() => {
    const confirmed = target?.cell.confirmed ?? null
    setIsWorking(confirmed ? confirmed.isWorking : true)
    setSpan(confirmed?.span ?? 'full_day')
    setRounds(confirmed && confirmed.roundsCapacity > 0 ? confirmed.roundsCapacity : 1)
    setCourseId(confirmed?.golfCourseId ?? '')
    setPinned(confirmed?.origin === 'pinned')
    setNote(confirmed?.note ?? '')
  }, [target])

  // A day the month was never confirmed for opens on the caddie's main course,
  // which is where the run would have put them.
  useEffect(() => {
    if (courseId !== '' || !memberships.data) return
    const main = memberships.data.items.find(item => item.isPrimary)
    if (main) setCourseId(main.golfCourseId)
  }, [memberships.data, courseId])

  const courseById = useMemo(() => new Map(courses.map(course => [course.id, course])), [courses])
  const options = memberships.data?.items ?? []

  async function save() {
    if (!target || saving) return
    setSaving(true)
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-shifts/${encodeURIComponent(target.profile.id)}/${target.cell.date}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            isWorking,
            span: isWorking ? span : 'full_day',
            roundsCapacity: isWorking ? rounds : 0,
            golfCourseId: isWorking && courseId !== '' ? courseId : null,
            pinned,
            note: note.trim() === '' ? null : note.trim(),
          }),
        },
      )
      showToast({ tone: 'success', message: t('shifts:editor.saved') })
      onSaved()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('shifts:editor.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={target !== null}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title={t('shifts:editor.title')}
      description={target
        ? t('shifts:editor.subject', {
            name: target.profile.displayName,
            date: target.cell.date,
          })
        : undefined}
    >
      <div className="shift-day-editor space-y-4">
        <Field label={t('shifts:editor.working')} requirement="none">
          <NativeSelect
            value={isWorking ? 'working' : 'off'}
            onChange={event => setIsWorking(event.target.value === 'working')}
          >
            <option value="working">{t('shifts:editor.workingYes')}</option>
            <option value="off">{t('shifts:editor.workingNo')}</option>
          </NativeSelect>
        </Field>

        {isWorking ? (
          <>
            <Field label={t('shifts:editor.span')} requirement="none">
              <NativeSelect
                value={span}
                onChange={event => {
                  const next = event.target.value
                  setSpan(next)
                  // Half a day is one round; the API refuses anything else.
                  if (next !== 'full_day') setRounds(1)
                }}
              >
                <option value="full_day">{t('shifts:editor.spanFullDay')}</option>
                <option value="morning">{t('shifts:editor.spanMorning')}</option>
                <option value="afternoon">{t('shifts:editor.spanAfternoon')}</option>
              </NativeSelect>
            </Field>

            <Field label={t('shifts:editor.rounds')} requirement="none">
              <NativeSelect
                value={String(rounds)}
                disabled={span !== 'full_day'}
                onChange={event => setRounds(Number(event.target.value))}
              >
                <option value="1">{t('shifts:editor.roundsOne')}</option>
                <option value="2">{t('shifts:editor.roundsTwo')}</option>
              </NativeSelect>
            </Field>

            <Field
              label={t('shifts:editor.course')}
              requirement="none"
              hint={options.length === 0 ? t('shifts:editor.noCourses') : undefined}
            >
              <NativeSelect
                value={courseId}
                onChange={event => setCourseId(event.target.value)}
              >
                <option value="">{t('shifts:editor.unplaced')}</option>
                {options.map(membership => (
                  <option key={membership.golfCourseId} value={membership.golfCourseId}>
                    {courseById.get(membership.golfCourseId)?.name ?? membership.golfCourseId}
                    {membership.isPrimary ? ` ${t('shifts:editor.mainSuffix')}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        ) : null}

        <Field label={t('shifts:editor.pinned')} requirement="none" hint={t('shifts:editor.pinnedHint')}>
          <label className="flex items-center gap-2">
            <Input
              type="checkbox"
              className="h-4 w-4"
              checked={pinned}
              onChange={event => setPinned(event.target.checked)}
            />
            <span>{t('shifts:editor.pinnedLabel')}</span>
          </label>
        </Field>

        <Field label={t('shifts:editor.note')} requirement="none" hint={t('shifts:editor.noteHint')}>
          <NativeTextarea
            rows={3}
            value={note}
            onChange={event => setNote(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('common:action.cancel')}
          </Button>
          <Button type="button" variant="primary" onClick={() => void save()} disabled={saving}>
            <Pin />
            {saving ? t('shifts:editor.saving') : t('shifts:editor.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

export default ShiftBoardPage
