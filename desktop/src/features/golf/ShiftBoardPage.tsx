import { Button, Input } from '@tachyon-sdk/native-ui'
import { CalendarCheck, Pin, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, currentYearMonth, today } from '../../api'
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
import { YearMonthPicker, useYearMonthValue } from '../../components/YearMonthPicker'
import { useResource } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import {
  buildShiftRow,
  monthDates,
  paddedRange,
  STREAK_WARNING_DAYS,
  type ConfirmedShift,
  type ShiftAssignment,
  type ShiftAvailability,
  type ShiftCell,
} from './shiftBoard'

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

/** The one day the desk opened for editing. */
type ShiftEditTarget = { profile: CaddieProfile; cell: ShiftCell }

/** The course label a day cell has room for. */
function courseLabel(course: GolfCourse | undefined) {
  if (!course) return ''
  const short = course.shortName?.trim()
  return short && short.length > 0 ? short : course.name.slice(0, 2)
}

// The date string is already the JST calendar date, so read it as a plain
// UTC date; appending +09:00 would land on the previous UTC day.
function weekdayIndex(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function weekdayLabel(date: string) {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  return i18next.t(`common:weekday.${keys[weekdayIndex(date)] ?? 'sun'}`)
}

function isWeekend(date: string) {
  const day = weekdayIndex(date)
  return day === 0 || day === 6
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

export function ShiftBoardPage() {
  const { t } = useTranslation(['shifts', 'common'])
  const [currentWeekRequest, setCurrentWeekRequest] = useState(0)
  const {
    value: yearMonth,
    error: yearMonthError,
    setCandidate: setYearMonth,
  } = useYearMonthValue(currentYearMonth())
  const dates = useMemo(() => monthDates(yearMonth), [yearMonth])
  // Availability participates in consecutive-work warnings too, so both
  // sources need the same padded range around the displayed month.
  const range = paddedRange(dates)

  const profilesResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<CaddieProfile>>(`${COURSE_API}/caddie-profiles`),
      [],
    ),
  )
  const availabilityResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<ShiftAvailability>>(
        `${COURSE_API}/caddie-availabilities?from=${range.from}&to=${range.to}`,
      ),
      [range.from, range.to],
    ),
  )
  const assignmentsResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<ShiftAssignment>>(
        `${COURSE_API}/caddie-assignments?from=${range.from}&to=${range.to}`,
      ),
      [range.from, range.to],
    ),
  )
  const deadlineResource = useResource(
    useCallback(
      () => courseboardApiJson<AvailabilityDeadline | null>(
        `${COURSE_API}/caddie-availability-deadlines/${yearMonth}`,
      ),
      [yearMonth],
    ),
  )
  const unsubmittedResource = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<UnsubmittedCaddie>>(
        `${COURSE_API}/caddie-availability-submissions/${yearMonth}`,
      ),
      [yearMonth],
    ),
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

  const [confirming, setConfirming] = useState(false)
  const [lastRun, setLastRun] = useState<GeneratedMonth | null>(null)
  const [editing, setEditing] = useState<ShiftEditTarget | null>(null)
  // The rules are read once a month at most, so they sit behind a button
  // rather than taking a row of the toolbar on every visit.
  const [rulesOpen, setRulesOpen] = useState(false)

  const refresh = useCallback(() => {
    profilesResource.refresh()
    availabilityResource.refresh()
    assignmentsResource.refresh()
    deadlineResource.refresh()
    unsubmittedResource.refresh()
    shiftsResource.refresh()
  }, [
    profilesResource.refresh,
    availabilityResource.refresh,
    assignmentsResource.refresh,
    deadlineResource.refresh,
    unsubmittedResource.refresh,
    shiftsResource.refresh,
  ])
  useRegisterPageReload(refresh)

  // The month is confirmed from the requests on file. Re-running it is safe by
  // design — pinned days are carried through — so this is a plain button
  // rather than a confirmation the desk has to click past every month.
  const confirmMonth = useCallback(async () => {
    setConfirming(true)
    try {
      const run = await courseboardApiJson<GeneratedMonth>(
        `${COURSE_API}/caddie-shift-plans/${yearMonth}`,
        { method: 'POST' },
      )
      setLastRun(run)
      shiftsResource.refresh()
      showToast({
        tone: 'success',
        message: t('shifts:confirm.done', { n: String(run.daysWritten) }),
      })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('shifts:confirm.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setConfirming(false)
    }
  }, [yearMonth, shiftsResource.refresh, t])

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
    await courseboardApiJson<AvailabilityDeadline>(
      `${COURSE_API}/caddie-availability-deadlines/${yearMonth}`,
      { method: 'PUT', body: JSON.stringify({ deadlineDate }) },
    )
    deadlineResource.refresh()
  }, [yearMonth, deadlineResource.refresh])

  const showCurrentWeek = useCallback(() => {
    setYearMonth(today().slice(0, 7))
    setCurrentWeekRequest(request => request + 1)
  }, [setYearMonth])

  return (
    <div className="page-stack shift-board-page">
      <Panel>
        <div className="shift-board-toolbar flex flex-wrap items-end gap-3">
          <YearMonthPicker
            label={t('shifts:month')}
            value={yearMonth}
            error={yearMonthError}
            onChange={setYearMonth}
            className="shift-board-month-picker"
          />
          {/* The month picker is what the desk reads; the actions sit away
              from it, against the right edge. */}
          <div className="ml-auto flex flex-wrap items-end gap-3 pb-1">
            <Button type="button" variant="secondary" onClick={() => setRulesOpen(true)}>
              <SlidersHorizontal />
              {t('shifts:rules.open')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={confirming}
              onClick={() => void confirmMonth()}
            >
              <CalendarCheck />
              {confirming ? t('shifts:confirm.running') : t('shifts:confirm.action')}
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

      {lastRun ? (
        <ConfirmedRunNotice run={lastRun} rules={rulesResource.data ?? null} />
      ) : null}

      <SectionErrorBoundary resetKey={yearMonth}>
        <ShiftBoardResults
          yearMonth={yearMonth}
          dates={dates}
          profiles={profilesResource.data?.items ?? []}
          availabilities={availabilityResource.data?.items ?? []}
          assignments={assignmentsResource.data?.items ?? []}
          confirmedShifts={shiftsResource.data?.items ?? []}
          courses={coursesResource.data?.items ?? []}
          unsubmittedCaddies={unsubmittedResource.data?.items ?? []}
          loading={profilesResource.loading
            || availabilityResource.loading
            || assignmentsResource.loading}
          error={profilesResource.error ?? availabilityResource.error ?? assignmentsResource.error}
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
    </div>
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
  const unplaced = run.unplaced.length > 0
  const overworked = run.overworked.length > 0
  return (
    <Notice
      tone={unplaced || overworked || run.deadlineWarning ? 'warning' : 'info'}
      title={t('shifts:confirm.noticeTitle', { month: run.yearMonth })}
    >
      <p>
        {t('shifts:confirm.noticeBody', {
          n: String(run.daysWritten),
          pinned: String(run.pinnedKept),
        })}
      </p>
      {run.statutoryRestDays > 0 ? (
        <p>
          {t('shifts:confirm.statutoryRest', {
            n: String(run.statutoryRestDays),
            limit: String(rules?.maxConsecutiveWorkDays ?? 6),
          })}
        </p>
      ) : null}
      {overworked ? (
        <p>
          {t('shifts:confirm.overworked', {
            names: run.overworked.join('、'),
            limit: String(rules?.maxConsecutiveWorkDays ?? 6),
          })}
        </p>
      ) : null}
      {unplaced ? (
        <p>{t('shifts:confirm.unplaced', { names: run.unplaced.join('、') })}</p>
      ) : null}
      {run.deadlineWarning ? (
        <p>
          {t('shifts:confirm.unsubmitted', {
            names: run.deadlineWarning.unsubmittedCaddieNames.join('、'),
          })}
        </p>
      ) : null}
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
  dates,
  profiles,
  availabilities,
  assignments,
  confirmedShifts,
  courses,
  unsubmittedCaddies,
  loading,
  error,
  onRetry,
  currentWeekRequest,
  onShowCurrentWeek,
  onEdit,
}: {
  yearMonth: string
  dates: string[]
  profiles: CaddieProfile[]
  availabilities: ShiftAvailability[]
  assignments: ShiftAssignment[]
  confirmedShifts: ConfirmedShift[]
  courses: GolfCourse[]
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
  const courseById = useMemo(
    () => new Map(courses.map(course => [course.id, course])),
    [courses],
  )
  const rows = useMemo(() => profiles.map(profile => ({
    profile,
    row: buildShiftRow(profile, dates, availabilities, assignments, confirmedShifts),
  })), [profiles, dates, availabilities, assignments, confirmedShifts])
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
    const frame = window.requestAnimationFrame(() => scrollToDate(today()))
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

      {!error && rows.length > 0 ? (
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
                      className={isWeekend(date) ? 'shift-board-weekend' : undefined}
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
                          <span className="shift-board-profile-name">{profile.displayName}</span>
                          {statusLabel ? (
                            <span className="shift-board-profile-status">
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
                          className={isWeekend(cell.date) ? 'shift-board-weekend' : undefined}
                        >
                          <button
                            type="button"
                            className="shift-board-cell-button"
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
                            {cell.confirmed?.golfCourseId ? (
                              <span className="shift-board-course" aria-hidden="true">
                                {courseLabel(courseById.get(cell.confirmed.golfCourseId))}
                              </span>
                            ) : null}
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
