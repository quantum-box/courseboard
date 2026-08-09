import { Button } from '@tachyon-sdk/native-ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, currentYearMonth, today } from '../../api'
import {
  EmptyState,
  LoadingState,
  Notice,
  PageRefreshButton,
  Panel,
  ResourceError,
} from '../../components/Page'
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary'
import { YearMonthPicker, useYearMonthValue } from '../../components/YearMonthPicker'
import { useResource } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  buildShiftRow,
  monthDates,
  paddedRange,
  STREAK_WARNING_DAYS,
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

  const refresh = useCallback(() => {
    profilesResource.refresh()
    availabilityResource.refresh()
    assignmentsResource.refresh()
  }, [profilesResource.refresh, availabilityResource.refresh, assignmentsResource.refresh])
  useRegisterPageReload(refresh)

  const showCurrentWeek = useCallback(() => {
    setYearMonth(today().slice(0, 7))
    setCurrentWeekRequest(request => request + 1)
  }, [setYearMonth])

  return (
    <div className="page-stack shift-board-page">
      <Panel>
        <div className="shift-board-toolbar flex flex-wrap items-end gap-3">
          <div className="page-toolbar order-last ml-auto self-end">
            <PageRefreshButton onClick={refresh} label={t('common:action.refresh')} />
          </div>
          <YearMonthPicker
            label={t('shifts:month')}
            value={yearMonth}
            error={yearMonthError}
            onChange={setYearMonth}
            className="shift-board-month-picker"
          />
          <div className="shift-board-threshold pb-1 text-muted-foreground">
            {t('shifts:streak.threshold')}
          </div>
        </div>
      </Panel>

      <SectionErrorBoundary resetKey={yearMonth}>
        <ShiftBoardResults
          yearMonth={yearMonth}
          dates={dates}
          profiles={profilesResource.data?.items ?? []}
          availabilities={availabilityResource.data?.items ?? []}
          assignments={assignmentsResource.data?.items ?? []}
          loading={profilesResource.loading
            || availabilityResource.loading
            || assignmentsResource.loading}
          error={profilesResource.error ?? availabilityResource.error ?? assignmentsResource.error}
          onRetry={refresh}
          currentWeekRequest={currentWeekRequest}
          onShowCurrentWeek={showCurrentWeek}
        />
      </SectionErrorBoundary>
    </div>
  )
}

function ShiftBoardResults({
  yearMonth,
  dates,
  profiles,
  availabilities,
  assignments,
  loading,
  error,
  onRetry,
  currentWeekRequest,
  onShowCurrentWeek,
}: {
  yearMonth: string
  dates: string[]
  profiles: CaddieProfile[]
  availabilities: ShiftAvailability[]
  assignments: ShiftAssignment[]
  loading: boolean
  error: unknown
  onRetry: () => void
  currentWeekRequest: number
  onShowCurrentWeek: () => void
}) {
  const { t } = useTranslation(['shifts', 'common'])
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canScrollBack, setCanScrollBack] = useState(false)
  const [canScrollForward, setCanScrollForward] = useState(false)
  const rows = useMemo(() => profiles.map(profile => ({
    profile,
    row: buildShiftRow(profile, dates, availabilities, assignments),
  })), [profiles, dates, availabilities, assignments])
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
                          className={isWeekend(cell.date) ? 'shift-board-weekend' : undefined}
                        >
                          <span className="shift-board-mark" aria-hidden="true">
                            {cellDisplay(cell)}
                          </span>
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

export default ShiftBoardPage
