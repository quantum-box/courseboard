import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  CalendarRange,
  Download,
  FileSpreadsheet,
  RefreshCw,
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
import {
  currentYearMonth,
  downloadText,
  fieldApiJson,
  fieldApiText,
  fieldTenant,
  yen,
} from '../../api'
import { useRegisterPageReload } from '../../lib/pageReload'
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
  PageHeader,
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
  const tenant = useMemo(() => fieldTenant(), [])
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
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [csvContents, setCsvContents] = useState('')
  const [csvFilename, setCsvFilename] = useState('')
  const [csvError, setCsvError] = useState<string | null>(null)
  const [csvMessage, setCsvMessage] = useState<string | null>(null)
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
        fieldApiJson<{ items: GolfCourse[] }>(
          '/v1/erp/extensions/golf-course/courses',
        ),
        fieldApiJson<{ items: DailyBudget[] }>(
          `/v1/erp/extensions/golf-course/daily-budgets?${budgetParams.toString()}`,
        ),
      ])
      setCourses(coursePayload.items)
      setBudgets(budgetPayload.items)

      try {
        const achievementPayload = await fieldApiJson<{
          items: DailyBudgetAchievement[]
        }>(
          `/v1/erp/extensions/golf-course/daily-budgets/achievement?${achievementParams.toString()}`,
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
    setSavedMessage(null)

    const targetRevenue = Number(draft.targetRevenue)
    const targetAverageSpend = Number(draft.targetAverageSpend)
    const targetCaddyAttachedRatio = Number(draft.targetCaddyAttachedRatio)
    if (!draft.golfCourseId || !draft.date) {
      setSaveError('コースと日付を選択してください。')
      return
    }
    if (!Number.isSafeInteger(targetRevenue) || targetRevenue < 0) {
      setSaveError('目標売上は0円以上の整数で入力してください。')
      return
    }
    if (!Number.isSafeInteger(targetAverageSpend) || targetAverageSpend < 0) {
      setSaveError('目標客単価は0円以上の整数で入力してください。')
      return
    }
    if (
      !Number.isFinite(targetCaddyAttachedRatio)
      || targetCaddyAttachedRatio < 0
      || targetCaddyAttachedRatio > 100
    ) {
      setSaveError('キャディ付き比率は0〜100%で入力してください。')
      return
    }

    setSaving(true)
    try {
      await fieldApiJson<unknown>(
        '/v1/erp/extensions/golf-course/daily-budgets',
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
      setSavedMessage(`${draft.date} の予算を保存しました。`)
      await load()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '予算を保存できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  async function chooseCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setCsvError(null)
    setCsvMessage(null)
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
        setCsvError(`CSVヘッダーを確認してください。必要な列: ${CSV_HEADER}`)
      }
    } catch {
      setCsvContents('')
      setCsvFilename('')
      setCsvError('CSVファイルを読み込めませんでした。')
    }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCsvMessage(null)
    if (!csvContents || csvError) return
    setImporting(true)
    try {
      await fieldApiText(
        '/v1/erp/extensions/golf-course/daily-budgets/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: csvContents,
        },
      )
      setCsvMessage(`${csvFilename} をインポートしました。`)
      setCsvContents('')
      setCsvFilename('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (error) {
      setCsvError(
        error instanceof Error ? error.message : 'CSVをインポートできませんでした。',
      )
    } finally {
      setImporting(false)
    }
  }

  const previewLines = csvContents.split(/\r?\n/).slice(0, 8).join('\n')

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Golf operations · ${tenant}`}
        title="日次予算"
        description="対象月の売上・客単価・キャディ付き比率を、予約実績と並べて調整します。"
        actions={(
          <Button type="button" onClick={() => void load()} disabled={loading} title="⌘R">
            <RefreshCw className={loading ? 'spin' : ''} /> 更新
          </Button>
        )}
      />

      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="対象月" required className="sm:w-48">
            <Input
              type="month"
              value={yearMonth}
              onChange={event => setYearMonth(event.target.value || currentYearMonth())}
            />
          </Field>
          <Field label="コース" className="sm:min-w-64">
            <NativeSelect
              value={courseFilter}
              onChange={event => setCourseFilter(event.target.value)}
            >
              <option value="all">すべてのコース</option>
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
            <span className="ml-2">コース絞り込みは登録済み予算一覧に適用</span>
          </div>
        </div>
      </Panel>

      {loading ? <LoadingState label="予算と実績を読み込んでいます" /> : null}
      {!loading && loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError ? (
        <>
          <Panel
            title="月間の進捗"
            description="全コースの予約実績を日次予算に重ねた運用ビューです。"
            actions={<Badge variant="outline">全コース · {achievements.length} 日分</Badge>}
          >
            {achievementError ? (
              <Notice tone="warning" title="実績を表示できません">
                予算の編集は利用できます。達成率APIが有効になった後に再度更新してください。
              </Notice>
            ) : achievements.length === 0 ? (
              <EmptyState
                title="この月の予算実績はありません"
                description="日次予算を登録すると、予約売上との達成率がここに表示されます。"
              />
            ) : (
              <div className="grid gap-4">
                <MetricGrid>
                  <Metric label="目標売上" value={yen(achievementSummary.target)} />
                  <Metric label="実績売上" value={yen(achievementSummary.actual)} />
                  <Metric
                    label="達成率"
                    value={rateLabel(achievementSummary.rate)}
                    tone={rateTone(achievementSummary.rate)}
                  />
                  <Metric
                    label="予約 / プレイヤー"
                    value={`${achievementSummary.reservations} / ${achievementSummary.players}`}
                    detail="件 / 人"
                  />
                </MetricGrid>
                <DataTable
                  rows={achievements}
                  rowKey={row => row.date}
                  columns={[
                    {
                      key: 'date',
                      header: '日付',
                      cell: row => row.date,
                    },
                    {
                      key: 'revenue',
                      header: '売上（実績 / 目標）',
                      align: 'right',
                      cell: row => (
                        <span>{yen(row.actualRevenue)} / {yen(row.targetRevenue)}</span>
                      ),
                    },
                    {
                      key: 'rate',
                      header: '達成率',
                      align: 'right',
                      cell: row => (
                        <Badge variant={rateBadgeVariant(row.revenueAchievementRate)}>
                          {rateLabel(row.revenueAchievementRate)}
                        </Badge>
                      ),
                    },
                    {
                      key: 'average',
                      header: '客単価（実績 / 目標）',
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
                      header: 'キャディ比率（実績 / 目標）',
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
              title="1日分を追加・更新"
              description="同じコース・日付を保存すると、その日の予算を更新します。"
            >
              {courses.length === 0 ? (
                <EmptyState
                  title="コースが登録されていません"
                  description="設定 → コース管理 でコースを作成してください。"
                />
              ) : (
                <form className="grid gap-4" onSubmit={saveBudget}>
                  <FormGrid columns={2}>
                    <Field label="コース" required>
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
                    <Field label="日付" required>
                      <Input
                        required
                        type="date"
                        min={range.from}
                        max={range.to}
                        value={draft.date}
                        onChange={event => setDraft({ ...draft, date: event.target.value })}
                      />
                    </Field>
                    <Field label="目標売上" required hint="円・税込の運用目標">
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
                    <Field label="目標客単価" required hint="1プレイヤーあたり・円">
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
                    <Field label="キャディ付き比率" required hint="0〜100%">
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
                  {savedMessage ? <Notice tone="success">{savedMessage}</Notice> : null}
                  <div className="flex justify-end">
                    <Button variant="primary" size="lg" type="submit" disabled={saving}>
                      <Save /> {saving ? '保存中…' : '予算を保存'}
                    </Button>
                  </div>
                </form>
              )}
            </Panel>

            <Panel
              title="CSVインポート"
              description="読み込む内容をプレビューしてから一括反映します。"
              actions={(
                <Button
                  type="button"
                  size="sm"
                  onClick={() => downloadText(
                    'golf-daily-budgets-template.csv',
                    `${CSV_HEADER}\ncourse_001,${yearMonth}-01,1200000,12000,0.70\n`,
                  )}
                >
                  <Download /> テンプレート
                </Button>
              )}
            >
              <form className="grid gap-3" onSubmit={importCsv}>
                <Field label="CSVファイル" required hint={`ヘッダー: ${CSV_HEADER}`}>
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
                {csvMessage ? <Notice tone="success">{csvMessage}</Notice> : null}
                <Button
                  variant="primary"
                  size="lg"
                  type="submit"
                  disabled={!csvContents || Boolean(csvError) || importing}
                >
                  <Upload /> {importing ? 'インポート中…' : 'プレビュー内容を反映'}
                </Button>
              </form>
            </Panel>
          </div>

          <Panel
            title="登録済み予算"
            description={`${range.from} から ${range.to} まで`}
            actions={(
              <Badge variant="neutral">
                <Target /> {budgets.length} 件
              </Badge>
            )}
          >
            <DataTable
              rows={budgets}
              rowKey={row => row.id}
              empty={(
                <EmptyState
                  title="条件に合う予算はありません"
                  description="上のフォームまたはCSVから予算を登録できます。"
                />
              )}
              columns={[
                {
                  key: 'course',
                  header: 'コース',
                  cell: row => (
                    <div>
                      <strong>{courseNames.get(row.golfCourseId) ?? row.golfCourseId}</strong>
                      <div className="text-2xs text-subtle-foreground">{row.golfCourseId}</div>
                    </div>
                  ),
                },
                { key: 'date', header: '日付', cell: row => row.date },
                {
                  key: 'revenue',
                  header: '目標売上',
                  align: 'right',
                  cell: row => yen(row.targetRevenue),
                },
                {
                  key: 'average',
                  header: '目標客単価',
                  align: 'right',
                  cell: row => yen(row.targetAverageSpend),
                },
                {
                  key: 'ratio',
                  header: 'キャディ比率',
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
