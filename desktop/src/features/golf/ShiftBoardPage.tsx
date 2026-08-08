import { Tooltip, TooltipContent, TooltipTrigger } from '@tachyon-sdk/native-ui'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, currentYearMonth } from '../../api'
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

function employmentStatusLabel(status: string) {
  if (status === 'active') return null
  if (status === 'inactive' || status === 'suspended') {
    return i18next.t(`shifts:employment.${status}` as 'shifts:employment.inactive')
  }
  return i18next.t('shifts:employment.unknown')
}

export function ShiftBoardPage() {
  const { t } = useTranslation(['shifts', 'common'])
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

  return (
    <div className="page-stack">
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="page-toolbar order-last ml-auto self-end">
            <PageRefreshButton onClick={refresh} label={t('common:action.refresh')} />
          </div>
          <YearMonthPicker
            label={t('shifts:month')}
            value={yearMonth}
            error={yearMonthError}
            onChange={setYearMonth}
            className="sm:w-64"
          />
          <div className="pb-1 text-xs text-muted-foreground">
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
}: {
  yearMonth: string
  dates: string[]
  profiles: CaddieProfile[]
  availabilities: ShiftAvailability[]
  assignments: ShiftAssignment[]
  loading: boolean
  error: unknown
  onRetry: () => void
}) {
  const { t } = useTranslation(['shifts', 'common'])
  const rows = useMemo(() => profiles.map(profile => ({
    profile,
    row: buildShiftRow(profile, dates, availabilities, assignments),
  })), [profiles, dates, availabilities, assignments])
  const longStreakNames = rows
    .filter(entry => entry.row.maxStreak >= STREAK_WARNING_DAYS)
    .map(entry => entry.profile.displayName)
  const hasAnyPlan = rows.some(entry => entry.row.cells.some(cell => cell.kind !== 'none'))

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
          <div className="shift-board-scroll">
            <table className="shift-board" aria-label={t('shifts:table.aria', { month: yearMonth })}>
              <thead>
                <tr>
                  <th className="shift-board-name">{t('shifts:table.caddie')}</th>
                  <th className="shift-board-streak">{t('shifts:streak.header')}</th>
                  {dates.map(date => (
                    <th
                      key={date}
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
                          <span>{profile.displayName}</span>
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
                          className={isWeekend(cell.date) ? 'shift-board-weekend' : undefined}
                        >
                          {cell.assignments > 1 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="shift-board-mark">{cellGlyph(cell)}</span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {t('shifts:cell.assignments', { n: String(cell.assignments) })}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="shift-board-mark">{cellGlyph(cell)}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
        </Panel>
      ) : null}
    </>
  )
}

export default ShiftBoardPage
