import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  CalendarRange,
  Download,
  FileSpreadsheet,
  Save,
  Target,
  Upload,
} from 'lucide-react'
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  currentYearMonth,
  downloadText,
  courseboardApiJson,
  courseboardApiText,
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
  PageRefreshButton,
  Panel,
  ResourceError,
} from '../../components/Page'

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
  revenueAchievementRate: number | null
  targetAverageSpend: number
  actualAverageSpend: number | null
  targetCaddyAttachedRatio: number
  actualCaddyAttachedRatio: number | null
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

const CSV_HEADER =
  'golf_course_id,date,target_revenue,target_average_spend,target_caddy_attached_ratio'

type CsvColumn = {
  name: string
  labelKey:
    | 'golfCourseId'
    | 'date'
    | 'targetRevenue'
    | 'targetAverageSpend'
    | 'targetCaddyAttachedRatio'
  example: string
}

/**
 * The header names are the wire format the import endpoint forwards verbatim,
 * so they stay in English. Each one is paired with a translated explanation so
 * the people preparing the file can tell what belongs in the column.
 */
const CSV_COLUMNS: CsvColumn[] = [
  { name: 'golf_course_id', labelKey: 'golfCourseId', example: 'course_001' },
  { name: 'date', labelKey: 'date', example: '2026-04-01' },
  { name: 'target_revenue', labelKey: 'targetRevenue', example: '1200000' },
  { name: 'target_average_spend', labelKey: 'targetAverageSpend', example: '12000' },
  { name: 'target_caddy_attached_ratio', labelKey: 'targetCaddyAttachedRatio', example: '0.70' },
]

function monthRange(yearMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth)
  if (!match) {
    const fallback = currentYearMonth()
    return monthRange(fallback)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    from: `${yearMonth}-01`,
    to: `${yearMonth}-${String(endDay).padStart(2, '0')}`,
  }
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

function rateLabel(rate: number | null) {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function normalizeCsvHeader(contents: string) {
  return (contents.split(/\r?\n/, 1)[0] ?? '')
    .replace(/^\uFEFF/, '')
    .split(',')
    .map(value => value.trim())
    .join(',')
}

export function BudgetsPage() {
  const { t } = useTranslation(['budgets', 'common'])
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [courseFilter, setCourseFilter] = useState('all')
  const [courses, setCourses] = useState<GolfCourse[]>([])
  const [budgets, setBudgets] = useState<DailyBudget[]>([])
  const [achievements, setAchievements] = useState<DailyBudgetAchievement[]>([])
  const [achievementError, setAchievementError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [draft, setDraft] = useState<BudgetDraft>(() => ({
    golfCourseId: '',
    date: `${currentYearMonth()}-01`,
    targetRevenue: '',
    targetAverageSpend: '',
    targetCaddyAttachedRatio: '',
  }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [csvContents, setCsvContents] = useState('')
  const [csvFilename, setCsvFilename] = useState('')
  const [csvError, setCsvError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const range = useMemo(() => monthRange(yearMonth), [yearMonth])
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
      rate: target > 0 ? actual / target : null,
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

  async function chooseCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setCsvError(null)
    if (!file) {
      setCsvContents('')
      setCsvFilename('')
      return
    }
    try {
      const contents = (await file.text()).replace(/^\uFEFF/, '')
      setCsvContents(contents)
      setCsvFilename(file.name)
      if (normalizeCsvHeader(contents) !== CSV_HEADER) {
        setCsvError(t('budgets:csv.headerError', { header: CSV_HEADER }))
      }
    } catch {
      setCsvContents('')
      setCsvFilename('')
      setCsvError(t('budgets:csv.readError'))
    }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!csvContents || csvError) return
    setImporting(true)
    try {
      await courseboardApiText(
        '/v1/course/daily-budgets/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: csvContents,
        },
      )
      showToast({
        tone: 'success',
        title: t('common:state.saved'),
        message: t('budgets:csv.imported', { name: csvFilename }),
      })
      setCsvContents('')
      setCsvFilename('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (error) {
      setCsvError(
        error instanceof Error ? error.message : t('budgets:csv.importError'),
      )
    } finally {
      setImporting(false)
    }
  }

  const previewLines = csvContents.split(/\r?\n/).slice(0, 8).join('\n')

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <PageRefreshButton
          onClick={() => void load()}
          loading={loading}
          label={t('common:action.refresh')}
        />
      </div>

      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field requirement="none" label={t('budgets:filter.month')} className="sm:w-48">
            <Input
              type="month"
              value={yearMonth}
              onChange={event => setYearMonth(event.target.value || currentYearMonth())}
            />
          </Field>
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
                      cell: row => (
                        <Badge variant={rateBadgeVariant(row.revenueAchievementRate)}>
                          {rateLabel(row.revenueAchievementRate)}
                        </Badge>
                      ),
                    },
                    {
                      key: 'average',
                      header: t('budgets:progress.table.perPlayer'),
                      align: 'right',
                      cell: row => (
                        <span>
                          {row.actualAverageSpend === null ? '—' : yen(row.actualAverageSpend)}
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
                          {row.actualCaddyAttachedRatio === null
                            ? '—'
                            : `${Math.round(row.actualCaddyAttachedRatio * 100)}%`}
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

            <Panel
              title={t('budgets:csv.title')}
              description={t('budgets:csv.description')}
              actions={(
                <Button
                  type="button"
                  size="sm"
                  onClick={() => downloadText(
                    'golf-daily-budgets-template.csv',
                    `${CSV_HEADER}\ncourse_001,${yearMonth}-01,1200000,12000,0.70\n`,
                  )}
                >
                  <Download /> {t('budgets:csv.template')}
                </Button>
              )}
            >
              <div className="grid gap-2 pb-3">
                <div className="text-xs font-medium">{t('budgets:csv.columns.title')}</div>
                <p className="text-2xs text-muted-foreground">
                  {t('budgets:csv.columns.description')}
                </p>
                <DataTable
                  rows={CSV_COLUMNS}
                  rowKey={column => column.name}
                  columns={[
                    {
                      key: 'name',
                      header: t('budgets:csv.columns.header'),
                      mobileLabel: t('budgets:csv.columns.header'),
                      cell: column => <code className="text-2xs">{column.name}</code>,
                    },
                    {
                      key: 'meaning',
                      header: t('budgets:csv.columns.meaning'),
                      mobileLabel: t('budgets:csv.columns.meaning'),
                      cell: column => (
                        <span className="text-xs">
                          {t(`budgets:csv.columns.${column.labelKey}` as 'budgets:csv.columns.date')}
                        </span>
                      ),
                    },
                    {
                      key: 'example',
                      header: t('budgets:csv.columns.example'),
                      mobileLabel: t('budgets:csv.columns.example'),
                      cell: column => <code className="text-2xs">{column.example}</code>,
                    },
                  ]}
                />
                {courses.length > 0 ? (
                  <div className="grid gap-1 rounded-md border border-border bg-muted/20 p-3">
                    <div className="text-xs font-medium">
                      {t('budgets:csv.columns.courseIdsTitle')}
                    </div>
                    <ul className="grid gap-0.5">
                      {courses.map(course => (
                        <li key={course.id} className="text-2xs text-muted-foreground">
                          {course.name}
                          {' = '}
                          <code>{course.id}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <form className="grid gap-3" onSubmit={importCsv}>
                <Field
                  label={t('budgets:csv.file')}
                  required
                  hint={t('budgets:csv.fileHint', { header: CSV_HEADER })}
                >
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={event => void chooseCsv(event)}
                  />
                </Field>
                {csvContents ? (
                  <div className="overflow-hidden rounded-md border border-border bg-muted/30">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium">
                      <FileSpreadsheet className="size-3.5" /> {csvFilename}
                    </div>
                    <pre className="max-h-48 overflow-auto p-3 text-2xs leading-5 text-muted-foreground">
                      {previewLines}
                    </pre>
                  </div>
                ) : null}
                {csvError ? <Notice tone="danger">{csvError}</Notice> : null}
                <Button
                  variant="primary"
                  size="lg"
                  type="submit"
                  disabled={!csvContents || Boolean(csvError) || importing}
                >
                  <Upload /> {importing ? t('budgets:csv.importing') : t('budgets:csv.apply')}
                </Button>
              </form>
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
                  cell: row => (
                    <div>
                      <strong>{courseNames.get(row.golfCourseId) ?? row.golfCourseId}</strong>
                      <div className="text-2xs text-subtle-foreground">{row.golfCourseId}</div>
                    </div>
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
