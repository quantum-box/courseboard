import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  CalendarRange,
  Save,
  Target,
} from 'lucide-react'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import {
  currentYearMonth,
  courseboardApiJson,
  yen,
} from '../../api'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { YearMonthPicker, useRouteYearMonthValue } from '../../components/YearMonthPicker'
import { navigate, useRouteParamState } from '../../lib/router'
import { yearMonthRange } from '../../lib/yearMonth'

type GolfCourse = {
  id: string
  name: string
  code?: string | null
}

type DailyBudget = {
  id: string
  golfCourseId: string
  date: string
  targetRevenue: number
  targetAverageSpend: number
  targetCaddyAttachedRatio: number
  updatedAt: string
}

type DailyBudgetAchievement = {
  date: string
  targetRevenue: number
  actualRevenue: number
  targetAverageSpend: number
  actualAverageSpend?: number | null
  targetCaddyAttachedRatio: number
  actualCaddyAttachedRatio?: number | null
  reservationCount: number
  playerCount: number
}

type BudgetDraft = {
  golfCourseId: string
  date: string
  targetRevenue: string
  targetAverageSpend: string
  targetCaddyAttachedRatio: string
}

function monthRange(yearMonth: string, fallbackYearMonth: string) {
  const range = yearMonthRange(yearMonth) ?? yearMonthRange(fallbackYearMonth)
  return range
    ? { from: range.from, to: range.to }
    : { from: '', to: '' }
}

function rateTone(rate: number | null) {
  if (rate === null) return 'neutral' as const
  if (rate >= 1) return 'success' as const
  if (rate >= 0.8) return 'warning' as const
  return 'danger' as const
}

function rateBadgeVariant(rate: number | null) {
  if (rate === null) return 'neutral' as const
  if (rate >= 1) return 'success' as const
  if (rate >= 0.8) return 'warning' as const
  return 'destructive' as const
}

function optionalNumberLabel(
  value: number | null | undefined,
  format: (value: number) => string,
) {
  return value == null || !Number.isFinite(value) ? '—' : format(value)
}

function rateLabel(rate: number | null | undefined) {
  return optionalNumberLabel(rate, value => `${Math.round(value * 100)}%`)
}

function revenueAchievementRate(actualRevenue: number, targetRevenue: number) {
  return targetRevenue > 0 ? actualRevenue / targetRevenue : null
}

export function BudgetsPage() {
  const { t } = useTranslation(['budgets', 'common'])
  const timezone = useTenantTimezone()
  const tenantYearMonth = currentYearMonth(timezone)
  const {
    value: yearMonth,
    error: yearMonthError,
    setCandidate: setYearMonth,
  } = useRouteYearMonthValue('yearMonth', tenantYearMonth)
  /** `all`, or the one course the month is narrowed to. */
  const [courseFilter, setCourseFilter] = useRouteParamState('course', { fallback: 'all' })
  const [courses, setCourses] = useState<GolfCourse[]>([])
  const [budgets, setBudgets] = useState<DailyBudget[]>([])
  const [achievements, setAchievements] = useState<DailyBudgetAchievement[]>([])
  const [achievementError, setAchievementError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [draft, setDraft] = useState<BudgetDraft>(() => ({
    golfCourseId: '',
    date: `${tenantYearMonth}-01`,
    targetRevenue: '',
    targetAverageSpend: '',
    targetCaddyAttachedRatio: '',
  }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)


  const range = useMemo(
    () => monthRange(yearMonth, tenantYearMonth),
    [tenantYearMonth, yearMonth],
  )
  const courseNames = useMemo(
    () => new Map(courses.map(course => [course.id, course.name] as const)),
    [courses],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setAchievementError(null)
    const budgetParams = new URLSearchParams({ from: range.from, to: range.to })
    if (courseFilter !== 'all') budgetParams.set('golfCourseId', courseFilter)
    const achievementParams = new URLSearchParams({ from: range.from, to: range.to })

    try {
      const [coursePayload, budgetPayload] = await Promise.all([
        courseboardApiJson<{ items: GolfCourse[] }>(
          '/v1/course/courses',
        ),
        courseboardApiJson<{ items: DailyBudget[] }>(
          `/v1/course/daily-budgets?${budgetParams.toString()}`,
        ),
      ])
      setCourses(coursePayload.items)
      setBudgets(budgetPayload.items)

      try {
        const achievementPayload = await courseboardApiJson<{
          items: DailyBudgetAchievement[]
        }>(
          `/v1/course/daily-budgets/achievement?${achievementParams.toString()}`,
        )
        setAchievements(achievementPayload.items)
      } catch (error) {
        setAchievements([])
        setAchievementError(error)
      }
    } catch (error) {
      setLoadError(error)
      setBudgets([])
      setAchievements([])
    } finally {
      setLoading(false)
    }
  }, [courseFilter, range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  useRegisterPageReload(load)

  useEffect(() => {
    if (courses.length === 0) return
    setDraft(previous => {
      if (courses.some(course => course.id === previous.golfCourseId)) return previous
      return { ...previous, golfCourseId: courses[0]?.id ?? '' }
    })
  }, [courses])

  useEffect(() => {
    setDraft(previous => (
      previous.date.startsWith(`${yearMonth}-`)
        ? previous
        : { ...previous, date: `${yearMonth}-01` }
    ))
  }, [yearMonth])

  const achievementSummary = useMemo(() => {
    const target = achievements.reduce((sum, item) => sum + item.targetRevenue, 0)
    const actual = achievements.reduce((sum, item) => sum + item.actualRevenue, 0)
    const reservations = achievements.reduce(
      (sum, item) => sum + item.reservationCount,
      0,
    )
    const players = achievements.reduce((sum, item) => sum + item.playerCount, 0)
    return {
      target,
      actual,
      reservations,
      players,
      rate: revenueAchievementRate(actual, target),
    }
  }, [achievements])

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaveError(null)

    const targetRevenue = Number(draft.targetRevenue)
    const targetAverageSpend = Number(draft.targetAverageSpend)
    const targetCaddyAttachedRatio = Number(draft.targetCaddyAttachedRatio)
    if (!draft.golfCourseId || !draft.date) {
      setSaveError(t('budgets:validation.courseAndDate'))
      return
    }
    if (!Number.isSafeInteger(targetRevenue) || targetRevenue < 0) {
      setSaveError(t('budgets:validation.targetRevenue'))
      return
    }
    if (!Number.isSafeInteger(targetAverageSpend) || targetAverageSpend < 0) {
      setSaveError(t('budgets:validation.targetPerPlayer'))
      return
    }
    if (
      !Number.isFinite(targetCaddyAttachedRatio)
      || targetCaddyAttachedRatio < 0
      || targetCaddyAttachedRatio > 100
    ) {
      setSaveError(t('budgets:validation.caddieRate'))
      return
    }

    setSaving(true)
    try {
      await courseboardApiJson<unknown>(
        '/v1/course/daily-budgets',
        {
          method: 'POST',
          body: JSON.stringify({
            golfCourseId: draft.golfCourseId,
            date: draft.date,
            targetRevenue,
            targetAverageSpend,
            targetCaddyAttachedRatio: targetCaddyAttachedRatio / 100,
          }),
        },
      )
      showToast({
        tone: 'success',
        title: t('common:state.saved'),
        message: t('budgets:editor.saved', { date: draft.date }),
      })
      await load()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('budgets:saveFailed'))
    } finally {
      setSaving(false)
    }
  }


  return (
    <div className="page-stack">
      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <YearMonthPicker
            label={t('budgets:filter.month')}
            value={yearMonth}
            error={yearMonthError}
            onChange={setYearMonth}
            className="sm:w-64"
          />
          <Field requirement="none" label={t('budgets:filter.course')} className="sm:min-w-64">
            <NativeSelect
              value={courseFilter}
              onChange={event => setCourseFilter(event.target.value)}
            >
              <option value="all">{t('budgets:filter.allCourses')}</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="pb-1 text-xs text-muted-foreground">
            <CalendarRange className="mr-1 inline size-3.5" />
            {range.from} — {range.to}
            <span className="ml-2">{t('budgets:filter.courseNote')}</span>
          </div>
        </div>
      </Panel>

      {loading ? <LoadingState label={t('budgets:loading')} /> : null}
      {!loading && loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError ? (
        <>
          <Panel
            title={t('budgets:progress.title')}
            description={t('budgets:progress.description')}
            actions={(
              <Badge variant="outline">
                {t('budgets:progress.badge', { n: String(achievements.length) })}
              </Badge>
            )}
          >
            {achievementError ? (
              <Notice tone="warning" title={t('budgets:progress.unavailable.title')}>
                {t('budgets:progress.unavailable.description')}
              </Notice>
            ) : achievements.length === 0 ? (
              <EmptyState
                title={t('budgets:progress.empty.title')}
                description={t('budgets:progress.empty.description')}
              />
            ) : (
              <div className="grid gap-4">
                <MetricGrid>
                  <Metric
                    label={t('budgets:progress.metrics.target')}
                    value={yen(achievementSummary.target)}
                  />
                  <Metric
                    label={t('budgets:progress.metrics.actual')}
                    value={yen(achievementSummary.actual)}
                  />
                  <Metric
                    label={t('budgets:progress.metrics.rate')}
                    value={rateLabel(achievementSummary.rate)}
                    tone={rateTone(achievementSummary.rate)}
                  />
                  <Metric
                    label={t('budgets:progress.metrics.bookings')}
                    value={`${achievementSummary.reservations} / ${achievementSummary.players}`}
                    detail={t('budgets:progress.metrics.bookingsDetail')}
                  />
                </MetricGrid>
                <DataTable
                  rows={achievements}
                  // The API returns one row per course and date but names no
                  // course, so the date alone collides on "all courses".
                  rowKey={(row, index) => `${row.date}-${index}`}
                  columns={[
                    {
                      key: 'date',
                      header: t('budgets:progress.table.date'),
                      cell: row => row.date,
                    },
                    {
                      key: 'revenue',
                      header: t('budgets:progress.table.revenue'),
                      align: 'right',
                      cell: row => (
                        <span>{yen(row.actualRevenue)} / {yen(row.targetRevenue)}</span>
                      ),
                    },
                    {
                      key: 'rate',
                      header: t('budgets:progress.table.rate'),
                      align: 'right',
                      cell: row => {
                        const rate = revenueAchievementRate(
                          row.actualRevenue,
                          row.targetRevenue,
                        )
                        return (
                          <Badge variant={rateBadgeVariant(rate)}>
                            {rateLabel(rate)}
                          </Badge>
                        )
                      },
                    },
                    {
                      key: 'average',
                      header: t('budgets:progress.table.perPlayer'),
                      align: 'right',
                      cell: row => (
                        <span>
                          {optionalNumberLabel(row.actualAverageSpend, value => yen(value))}
                          {' / '}{yen(row.targetAverageSpend)}
                        </span>
                      ),
                    },
                    {
                      key: 'caddie',
                      header: t('budgets:progress.table.caddieRate'),
                      align: 'right',
                      cell: row => (
                        <span>
                          {optionalNumberLabel(
                            row.actualCaddyAttachedRatio,
                            value => `${Math.round(value * 100)}%`,
                          )}
                          {' / '}{Math.round(row.targetCaddyAttachedRatio * 100)}%
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <Panel
              title={t('budgets:editor.title')}
              description={t('budgets:editor.description')}
            >
              {courses.length === 0 ? (
                <EmptyState
                  title={t('budgets:editor.noCourses.title')}
                  description={t('budgets:editor.noCourses.description')}
                />
              ) : (
                <form className="grid gap-4" onSubmit={saveBudget}>
                  <FormGrid columns={2}>
                    <Field label={t('budgets:editor.course')} required>
                      <NativeSelect
                        required
                        value={draft.golfCourseId}
                        onChange={event => setDraft({ ...draft, golfCourseId: event.target.value })}
                      >
                        {courses.map(course => (
                          <option key={course.id} value={course.id}>{course.name}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label={t('budgets:editor.date')} required>
                      <Input
                        required
                        type="date"
                        min={range.from}
                        max={range.to}
                        value={draft.date}
                        onChange={event => setDraft({ ...draft, date: event.target.value })}
                      />
                    </Field>
                    <Field
                      label={t('budgets:editor.targetRevenue')}
                      required
                      hint={t('budgets:editor.targetRevenueHint')}
                    >
                      <Input
                        required
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={draft.targetRevenue}
                        onChange={event => setDraft({ ...draft, targetRevenue: event.target.value })}
                        placeholder="1200000"
                      />
                    </Field>
                    <Field
                      label={t('budgets:editor.targetPerPlayer')}
                      required
                      hint={t('budgets:editor.targetPerPlayerHint')}
                    >
                      <Input
                        required
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={draft.targetAverageSpend}
                        onChange={event => setDraft({ ...draft, targetAverageSpend: event.target.value })}
                        placeholder="12000"
                      />
                    </Field>
                    <Field
                      label={t('budgets:editor.caddieRate')}
                      required
                      hint={t('budgets:editor.caddieRateHint')}
                    >
                      <Input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        inputMode="decimal"
                        value={draft.targetCaddyAttachedRatio}
                        onChange={event => setDraft({
                          ...draft,
                          targetCaddyAttachedRatio: event.target.value,
                        })}
                        placeholder="70"
                      />
                    </Field>
                  </FormGrid>
                  {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
                  <div className="flex justify-end">
                    <Button variant="primary" size="lg" type="submit" disabled={saving}>
                      <Save /> {saving ? t('common:action.saving') : t('budgets:editor.save')}
                    </Button>
                  </div>
                </form>
              )}
            </Panel>

            <Panel title="日次予算をとりこむ" description="CSV・Excelを全件確認してから保存します。大きいファイルは分割して処理します。">
              <Button onClick={() => navigate('golf/data-imports/dailyBudgets')}>データ取込を開く</Button>
            </Panel>
          </div>

          <Panel
            title={t('budgets:list.title')}
            description={t('budgets:list.description', { from: range.from, to: range.to })}
            actions={(
              <Badge variant="neutral">
                <Target /> {t('budgets:list.badge', { n: String(budgets.length) })}
              </Badge>
            )}
          >
            <DataTable
              rows={budgets}
              rowKey={row => row.id}
              empty={(
                <EmptyState
                  title={t('budgets:list.empty.title')}
                  description={t('budgets:list.empty.description')}
                />
              )}
              columns={[
                {
                  key: 'course',
                  header: t('budgets:list.table.course'),
                  // The course id shows only as a fallback, when the course is
                  // gone from the list and there is no name left to print.
                  cell: row => (
                    <strong>{courseNames.get(row.golfCourseId) ?? row.golfCourseId}</strong>
                  ),
                },
                { key: 'date', header: t('budgets:list.table.date'), cell: row => row.date },
                {
                  key: 'revenue',
                  header: t('budgets:list.table.targetRevenue'),
                  align: 'right',
                  cell: row => yen(row.targetRevenue),
                },
                {
                  key: 'average',
                  header: t('budgets:list.table.targetPerPlayer'),
                  align: 'right',
                  cell: row => yen(row.targetAverageSpend),
                },
                {
                  key: 'ratio',
                  header: t('budgets:list.table.caddieRate'),
                  align: 'right',
                  cell: row => `${Math.round(row.targetCaddyAttachedRatio * 100)}%`,
                },
              ]}
            />
          </Panel>
        </>
      ) : null}
    </div>
  )
}

export default BudgetsPage
