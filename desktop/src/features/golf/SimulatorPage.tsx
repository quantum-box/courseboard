import { Button, Input } from '@tachyon-sdk/native-ui'
import { Calculator, LineChart } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, courseboardApiText, yen } from '../../api'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { today } from '../../lib/clock'
import {
  PREFECTURES,
  buildGolfExtensionConfig,
  golfExtensionConfigToDraft,
  type GolfExtensionConfigDraft,
} from './extension-config'
import { Notice } from '../../components/Page'
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  Panel,
  ResourceError,
} from '../../components/Page'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const MAX_FEE_AMOUNT = 100_000_000
const MAX_VISITORS = 1_000_000

type PlayerBreakdown = {
  playerIndex: number
  fee: number
  exempt: boolean
  reason?: string | null
}

type FeeQuote = {
  courseGrade: string
  taxRate: number
  taxAmount: number
  total: number
  breakdown: PlayerBreakdown[]
}

type RangeRow = {
  greenFee: number
  courseGrade: string
  visitors: number
  taxableVisitors: number
  revenue: number
  taxTotal: number
  variableCost: number
  fixedCost: number
  profit: number
  profitMarginPct: number
}

type RangeSimulation = {
  projectedRevenueMin: number
  projectedRevenueMax: number
  taxTotal: number
  rows: RangeRow[]
  periodLabel: string
}

const counter = new Intl.NumberFormat('ja-JP')

function defaultDates(timezone: string) {
  const dateFrom = today(timezone)
  const [year, month, day] = dateFrom.split('-').map(Number)
  const dateTo = new Date(Date.UTC(year!, month!, day!)).toISOString().slice(0, 10)
  return { dateFrom, dateTo }
}

function numberValue(value: FormDataEntryValue | null) {
  return Number(value ?? Number.NaN)
}

function optionalNumber(value: FormDataEntryValue | null) {
  if (value == null || String(value).trim() === '') return undefined
  return Number(value)
}


/**
 * Where a course says which prefecture's tax schedule it is under.
 *
 * It sits on the pricing screen because that is where the operator finds out
 * it is missing: without it every quote is refused, and the refusal is not
 * something they can act on anywhere else.
 */
function TaxSettingsPanel() {
  const { t } = useTranslation(['simulator', 'common'])
  const [draft, setDraft] = useState<GolfExtensionConfigDraft | null>(null)
  const [original, setOriginal] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const status = await courseboardApiJson<{ configJson?: Record<string, unknown> | null }>(
          '/v1/course/extension-status',
        )
        const config = status.configJson ?? {}
        setOriginal(config)
        setDraft(golfExtensionConfigToDraft(config))
      } catch (reason) {
        setError(errorMessage(reason))
      }
    })()
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const configJson = buildGolfExtensionConfig(draft, original)
      await courseboardApiText('/v1/course/config', {
        method: 'PATCH',
        body: JSON.stringify({ scopeType: 'tenant', configJson }),
      })
      setOriginal(configJson)
      setSaved(true)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  if (!draft) return null

  return (
    <Panel title={t('simulator:tax.title')} description={t('simulator:tax.description')}>
      <form onSubmit={event => void save(event)}>
        <FormGrid>
          <Field label={t('simulator:tax.field.prefecture')} required>
            <NativeSelect
              value={draft.prefecture}
              onChange={event => setDraft({ ...draft, prefecture: event.target.value })}
            >
              <option value="">{t('simulator:tax.field.prefectureUnset')}</option>
              {PREFECTURES.map(code => (
                <option key={code} value={code}>{t(`simulator:tax.prefecture.${code}` as 'simulator:tax.prefecture.hokkaido')}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={t('simulator:tax.field.grade')}
            requirement="optional"
            hint={t('simulator:tax.field.gradeHint')}
          >
            <Input
              value={draft.taxGrade}
              onChange={event => setDraft({ ...draft, taxGrade: event.target.value })}
              placeholder="7"
            />
          </Field>
        </FormGrid>
        {error ? (
          <div className="mt-3">
            <Notice tone="danger" title={t('simulator:tax.failed')}>{error}</Notice>
          </div>
        ) : null}
        {saved ? (
          <div className="mt-3">
            <Notice tone="success" title={t('simulator:tax.saved')}>{t('simulator:tax.savedBody')}</Notice>
          </div>
        ) : null}
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? t('common:action.saving') : t('common:action.save')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

export function SimulatorPage() {
  const { t } = useTranslation(['simulator', 'common'])
  const timezone = useTenantTimezone()
  const dates = useMemo(() => defaultDates(timezone), [timezone])

  const [quote, setQuote] = useState<FeeQuote | null>(null)
  const [quoteError, setQuoteError] = useState<unknown>(null)
  const [quoting, setQuoting] = useState(false)

  const [simulation, setSimulation] = useState<RangeSimulation | null>(null)
  const [simulationError, setSimulationError] = useState<unknown>(null)
  const [simulating, setSimulating] = useState(false)

  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setQuote(null)
    setQuoteError(null)
    setQuoting(true)
    try {
      setQuote(
        await courseboardApiJson<FeeQuote>('/v1/course/simulator/calculate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            greenFee: numberValue(form.get('greenFee')),
            numHoles: form.get('numHoles') === '9' ? 9 : 18,
            cartFee: optionalNumber(form.get('cartFee')),
            caddyFee: optionalNumber(form.get('caddyFee')),
          }),
        }),
      )
    } catch (error) {
      setQuoteError(error)
    } finally {
      setQuoting(false)
    }
  }

  async function submitRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSimulation(null)
    setSimulationError(null)
    setSimulating(true)
    try {
      setSimulation(
        await courseboardApiJson<RangeSimulation>('/v1/course/simulator/simulate/range', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dateFrom: String(form.get('dateFrom') ?? ''),
            dateTo: String(form.get('dateTo') ?? ''),
            numVisitorsMin: numberValue(form.get('numVisitorsMin')),
            numVisitorsMax: numberValue(form.get('numVisitorsMax')),
            avgGreenFee: numberValue(form.get('avgGreenFee')),
          }),
        }),
      )
    } catch (error) {
      setSimulationError(error)
    } finally {
      setSimulating(false)
    }
  }

  const breakdownColumns: DataTableColumn<PlayerBreakdown>[] = [
    {
      key: 'player',
      header: t('simulator:quote.table.player'),
      cell: row => String(row.playerIndex + 1),
    },
    {
      key: 'tax',
      header: t('simulator:quote.table.tax'),
      align: 'right',
      cell: row => yen(row.fee),
    },
    {
      key: 'status',
      header: t('simulator:quote.table.status'),
      cell: row =>
        row.exempt
          ? t('simulator:quote.table.exempt', {
              reason: row.reason
                ? t(`simulator:quote.reason.${row.reason}`, { defaultValue: row.reason })
                : t('simulator:quote.reason.unknown'),
            })
          : t('simulator:quote.table.taxable'),
    },
  ]

  const rangeColumns: DataTableColumn<RangeRow>[] = [
    {
      key: 'greenFee',
      header: t('simulator:range.table.greenFee'),
      cell: row => yen(row.greenFee),
    },
    {
      key: 'grade',
      header: t('simulator:range.table.grade'),
      cell: row => row.courseGrade,
    },
    {
      key: 'visitors',
      header: t('simulator:range.table.visitors'),
      align: 'right',
      cell: row => counter.format(row.visitors),
    },
    {
      key: 'revenue',
      header: t('simulator:range.table.revenue'),
      align: 'right',
      cell: row => yen(row.revenue),
    },
    {
      key: 'taxTotal',
      header: t('simulator:range.table.taxTotal'),
      align: 'right',
      cell: row => yen(row.taxTotal),
    },
    {
      key: 'profit',
      header: t('simulator:range.table.profit'),
      align: 'right',
      cell: row => yen(row.profit),
    },
    {
      key: 'margin',
      header: t('simulator:range.table.margin'),
      align: 'right',
      cell: row => `${row.profitMarginPct.toFixed(1)}%`,
    },
  ]

  return (
    <>
      <TaxSettingsPanel />
      <Panel title={t('simulator:quote.title')} description={t('simulator:quote.description')}>
        <form onSubmit={event => void submitQuote(event)}>
          <FormGrid>
            <Field label={t('simulator:quote.field.greenFee')} required>
              <Input
                defaultValue={8000}
                max={MAX_FEE_AMOUNT}
                min={1}
                name="greenFee"
                required
                step={1}
                type="number"
              />
            </Field>
            <Field label={t('simulator:quote.field.numHoles')} required>
              <NativeSelect defaultValue="18" name="numHoles">
                <option value="18">{t('simulator:quote.holes.eighteen')}</option>
                <option value="9">{t('simulator:quote.holes.nine')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('simulator:quote.field.cartFee')}>
              <Input max={MAX_FEE_AMOUNT} min={0} name="cartFee" placeholder="0" step={1} type="number" />
            </Field>
            <Field label={t('simulator:quote.field.caddyFee')}>
              <Input max={MAX_FEE_AMOUNT} min={0} name="caddyFee" placeholder="0" step={1} type="number" />
            </Field>
          </FormGrid>
          <Button disabled={quoting} type="submit">
            <Calculator aria-hidden="true" />
            {quoting ? t('simulator:quote.submitting') : t('simulator:quote.submit')}
          </Button>
        </form>

        {quoteError ? <ResourceError error={quoteError} /> : null}
        {quoting ? <LoadingState label={t('simulator:quote.submitting')} /> : null}
        {quote ? (
          <>
            <MetricGrid>
              <Metric label={t('simulator:quote.metric.grade')} value={quote.courseGrade || '—'} />
              <Metric
                label={t('simulator:quote.metric.taxRate')}
                value={`${quote.taxRate.toFixed(2)}%`}
              />
              <Metric label={t('simulator:quote.metric.taxAmount')} value={yen(quote.taxAmount)} />
              <Metric label={t('simulator:quote.metric.total')} value={yen(quote.total)} />
            </MetricGrid>
            <DataTable
              rows={quote.breakdown}
              columns={breakdownColumns}
              rowKey={row => String(row.playerIndex)}
              empty={<EmptyState title={t('simulator:quote.empty')} />}
            />
          </>
        ) : quoting || quoteError ? null : (
          <EmptyState title={t('simulator:quote.prompt')} />
        )}
      </Panel>

      <Panel title={t('simulator:range.title')} description={t('simulator:range.description')}>
        <form onSubmit={event => void submitRange(event)}>
          <FormGrid>
            <Field label={t('simulator:range.field.dateFrom')} required>
              <Input defaultValue={dates.dateFrom} name="dateFrom" required type="date" />
            </Field>
            <Field label={t('simulator:range.field.dateTo')} required>
              <Input defaultValue={dates.dateTo} name="dateTo" required type="date" />
            </Field>
            <Field label={t('simulator:range.field.visitorsMin')} required>
              <Input
                defaultValue={60}
                max={MAX_VISITORS}
                min={0}
                name="numVisitorsMin"
                required
                step={1}
                type="number"
              />
            </Field>
            <Field label={t('simulator:range.field.visitorsMax')} required>
              <Input
                defaultValue={120}
                max={MAX_VISITORS}
                min={0}
                name="numVisitorsMax"
                required
                step={1}
                type="number"
              />
            </Field>
            <Field label={t('simulator:range.field.avgGreenFee')} required>
              <Input
                defaultValue={8000}
                max={MAX_FEE_AMOUNT}
                min={1}
                name="avgGreenFee"
                required
                step={1}
                type="number"
              />
            </Field>
          </FormGrid>
          <Button disabled={simulating} type="submit">
            <LineChart aria-hidden="true" />
            {simulating ? t('simulator:range.submitting') : t('simulator:range.submit')}
          </Button>
        </form>

        {simulationError ? <ResourceError error={simulationError} /> : null}
        {simulating ? <LoadingState label={t('simulator:range.submitting')} /> : null}
        {simulation ? (
          <>
            <MetricGrid>
              <Metric
                label={t('simulator:range.metric.revenueMin')}
                value={yen(simulation.projectedRevenueMin)}
              />
              <Metric
                label={t('simulator:range.metric.revenueMax')}
                value={yen(simulation.projectedRevenueMax)}
              />
              <Metric
                label={t('simulator:range.metric.taxTotal')}
                value={yen(simulation.taxTotal)}
                detail={simulation.periodLabel}
              />
            </MetricGrid>
            <DataTable
              rows={simulation.rows}
              columns={rangeColumns}
              rowKey={row => `${row.greenFee}-${row.visitors}`}
              empty={<EmptyState title={t('simulator:range.empty')} />}
            />
          </>
        ) : simulating || simulationError ? null : (
          <EmptyState title={t('simulator:range.prompt')} />
        )}
      </Panel>
    </>
  )
}
