import { Input, Tooltip, TooltipContent, TooltipTrigger } from '@tachyon-sdk/native-ui'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, currentYearMonth } from '../../api'
import {
  EmptyState,
  Field,
  LoadingState,
  Notice,
  PageHeader,
  PageRefreshButton,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  buildShiftRow,
  monthDates,
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

export function ShiftBoardPage() {
  const { t } = useTranslation(['shifts', 'common'])
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const dates = useMemo(() => monthDates(yearMonth), [yearMonth])
  const range = { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' }

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
      () => courseboardApiJson<ListResponse<ShiftAssignment>>(`${COURSE_API}/caddie-assignments`),
      [],
    ),
  )

  const refresh = useCallback(() => {
    profilesResource.refresh()
    availabilityResource.refresh()
    assignmentsResource.refresh()
  }, [profilesResource.refresh, availabilityResource.refresh, assignmentsResource.refresh])
  useRegisterPageReload(refresh)

  const loading = profilesResource.loading || availabilityResource.loading || assignmentsResource.loading
  const error = profilesResource.error ?? availabilityResource.error ?? assignmentsResource.error

  const profiles = useMemo(
    () => (profilesResource.data?.items ?? []).filter(profile => profile.employmentStatus !== 'suspended'),
    [profilesResource.data],
  )

  const rows = useMemo(() => {
    const availabilities = availabilityResource.data?.items ?? []
    const assignments = assignmentsResource.data?.items ?? []
    return profiles.map(profile => ({
      profile,
      row: buildShiftRow(profile.id, dates, availabilities, assignments),
    }))
  }, [profiles, dates, availabilityResource.data, assignmentsResource.data])

  const longStreakNames = rows
    .filter(entry => entry.row.maxStreak >= STREAK_WARNING_DAYS)
    .map(entry => entry.profile.displayName)

  const hasAnyPlan = rows.some(entry => entry.row.cells.some(cell => cell.kind !== 'none'))

  return (
    <div className="page-stack">
      <PageHeader
        title={t('shifts:title')}
        description={t('shifts:description')}
        actions={<PageRefreshButton onClick={refresh} label={t('common:action.refresh')} />}
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('shifts:month')} className="sm:w-48">
            <Input
              type="month"
              value={yearMonth}
              onChange={event => setYearMonth(event.target.value || currentYearMonth())}
            />
          </Field>
          <div className="pb-1 text-xs text-muted-foreground">
            {t('shifts:streak.threshold')}
          </div>
        </div>
      </Panel>

      {longStreakNames.length > 0 ? (
        <Notice tone="warning" title={t('shifts:streak.warningTitle')}>
          {t('shifts:streak.warningBody', {
            names: longStreakNames.join('、'),
            n: String(STREAK_WARNING_DAYS),
          })}
        </Notice>
      ) : null}

      {loading && rows.length === 0 ? <LoadingState label={t('shifts:loading')} /> : null}
      {error ? <ResourceError error={error} onRetry={refresh} /> : null}

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
                {rows.map(({ profile, row }) => (
                  <tr key={profile.id}>
                    <th scope="row" className="shift-board-name">{profile.displayName}</th>
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
                ))}
              </tbody>
            </table>
          </div>
          <div className="shift-board-legend" aria-label={t('shifts:legend.label')}>
            <span><i data-kind="assigned" /> {t('shifts:legend.assigned')}</span>
            <span><i data-kind="off" /> {t('shifts:legend.off')}</span>
            <span><i data-kind="morning" /> {t('shifts:legend.morning')}</span>
            <span><i data-kind="afternoon" /> {t('shifts:legend.afternoon')}</span>
            <span><i data-kind="light" /> {t('shifts:legend.light')}</span>
            <span><i data-long-streak="true" /> {t('shifts:streak.warningTitle')}</span>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

export default ShiftBoardPage
