import { defineRegistry } from '@json-render/react'
import { Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { insightsCatalog } from './catalog'
import './insights.css'

type Cell = string | number | null
type Row = Record<string, Cell>
type Series = { key: string; label: string }

const PALETTE = [
  'hsl(var(--nui-primary))',
  '#b88942',
  '#4f6d9a',
  '#b0644b',
  '#7a5c99',
  '#5a8f7b',
]

const numberFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 })

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => typeof row === 'object' && row !== null) : []
}

function num(value: Cell | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCell(value: Cell | undefined) {
  if (typeof value === 'number') return numberFormat.format(value)
  return value ?? '—'
}

/** A round axis maximum: 1, 2, 5 × 10ⁿ. */
function niceMax(value: number) {
  if (value <= 0) return 1
  const exponent = 10 ** Math.floor(Math.log10(value))
  const fraction = value / exponent
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return step * exponent
}

function ChartFrame({ title, children, legend }: { title?: string | null; children: ReactNode; legend?: Series[] }) {
  return (
    <figure className="insight-chart">
      {title ? <figcaption>{title}</figcaption> : null}
      {legend && legend.length > 1 ? (
        <ul className="insight-legend">
          {legend.map((item, index) => (
            <li key={item.key}>
              <span style={{ background: PALETTE[index % PALETTE.length] }} />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </figure>
  )
}

function EmptyChart() {
  return <p className="insight-empty">この期間のデータはありません。</p>
}

const WIDTH = 640
const HEIGHT = 260
const PAD = { top: 20, right: 12, bottom: 36, left: 44 }

function YAxis({ max }: { max: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  return (
    <g className="insight-axis">
      {ticks.map(ratio => {
        const y = PAD.top + plotHeight * (1 - ratio)
        return (
          <g key={ratio}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} />
            <text x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle">
              {numberFormat.format(max * ratio)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function VerticalBars({ rows, xKey, series, stacked }: { rows: Row[]; xKey: string; series: Series[]; stacked: boolean }) {
  const totals = rows.map(row => (stacked
    ? series.reduce((sum, item) => sum + num(row[item.key]), 0)
    : Math.max(...series.map(item => num(row[item.key])))))
  const max = niceMax(Math.max(0, ...totals))
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const band = plotWidth / rows.length
  const groupWidth = band * 0.7
  const barWidth = stacked ? groupWidth : groupWidth / series.length
  const showValues = rows.length * (stacked ? 1 : series.length) <= 24
  const labelEvery = Math.ceil(rows.length / 14)
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" className="insight-svg">
      <YAxis max={max} />
      {rows.map((row, rowIndex) => {
        const x0 = PAD.left + band * rowIndex + (band - groupWidth) / 2
        let stackTop = 0
        return (
          <g key={rowIndex}>
            {series.map((item, seriesIndex) => {
              const value = num(row[item.key])
              const height = (value / max) * plotHeight
              const x = stacked ? x0 : x0 + barWidth * seriesIndex
              const y = PAD.top + plotHeight - height - (stacked ? stackTop : 0)
              if (stacked) stackTop += height
              return (
                <g key={item.key}>
                  <rect x={x} y={y} width={Math.max(barWidth - 2, 1)} height={height} rx={2} fill={PALETTE[seriesIndex % PALETTE.length]}>
                    <title>{`${formatCell(row[xKey])} ${item.label}: ${formatCell(value)}`}</title>
                  </rect>
                  {showValues && !stacked ? (
                    <text className="insight-value" x={x + barWidth / 2 - 1} y={y - 4} textAnchor="middle">
                      {formatCell(value)}
                    </text>
                  ) : null}
                </g>
              )
            })}
            {rowIndex % labelEvery === 0 ? (
              <text className="insight-tick" x={x0 + groupWidth / 2} y={HEIGHT - PAD.bottom + 18} textAnchor="middle">
                {formatCell(row[xKey])}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function HorizontalBars({ rows, xKey, series }: { rows: Row[]; xKey: string; series: Series[] }) {
  const max = niceMax(Math.max(0, ...rows.flatMap(row => series.map(item => num(row[item.key])))))
  return (
    <div className="insight-hbars">
      {rows.map((row, rowIndex) => (
        <div className="insight-hbar-row" key={rowIndex}>
          <span className="insight-hbar-label">{formatCell(row[xKey])}</span>
          <div className="insight-hbar-tracks">
            {series.map((item, seriesIndex) => {
              const value = num(row[item.key])
              return (
                <div className="insight-hbar-track" key={item.key} title={`${item.label}: ${formatCell(value)}`}>
                  <div
                    className="insight-hbar-fill"
                    style={{ width: `${(value / max) * 100}%`, background: PALETTE[seriesIndex % PALETTE.length] }}
                  />
                  <span className="insight-hbar-value">{formatCell(value)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Lines({ rows, xKey, series }: { rows: Row[]; xKey: string; series: Series[] }) {
  const max = niceMax(Math.max(0, ...rows.flatMap(row => series.map(item => num(row[item.key])))))
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const step = rows.length > 1 ? plotWidth / (rows.length - 1) : 0
  const xOf = (index: number) => PAD.left + (rows.length > 1 ? step * index : plotWidth / 2)
  const yOf = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight
  const labelEvery = Math.ceil(rows.length / 12)
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" className="insight-svg">
      <YAxis max={max} />
      {series.map((item, seriesIndex) => {
        const color = PALETTE[seriesIndex % PALETTE.length]
        const points = rows.map((row, index) => `${xOf(index)},${yOf(num(row[item.key]))}`).join(' ')
        return (
          <g key={item.key}>
            <polyline points={points} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
            {rows.map((row, index) => (
              <circle key={index} cx={xOf(index)} cy={yOf(num(row[item.key]))} r={3.5} fill={color}>
                <title>{`${formatCell(row[xKey])} ${item.label}: ${formatCell(row[item.key])}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {rows.map((row, index) => (index % labelEvery === 0 ? (
        <text key={index} className="insight-tick" x={xOf(index)} y={HEIGHT - PAD.bottom + 18} textAnchor="middle">
          {formatCell(row[xKey])}
        </text>
      ) : null))}
    </svg>
  )
}

function Donut({ rows, labelKey, valueKey }: { rows: Row[]; labelKey: string; valueKey: string }) {
  const total = rows.reduce((sum, row) => sum + num(row[valueKey]), 0)
  const radius = 70
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="insight-donut">
      <svg viewBox="0 0 200 200" role="img">
        <circle cx={100} cy={100} r={radius} fill="none" stroke="hsl(var(--nui-muted))" strokeWidth={28} />
        {total > 0 ? rows.map((row, index) => {
          const share = num(row[valueKey]) / total
          const dash = share * circumference
          const segment = (
            <circle
              key={index}
              cx={100}
              cy={100}
              r={radius}
              fill="none"
              stroke={PALETTE[index % PALETTE.length]}
              strokeWidth={28}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            >
              <title>{`${formatCell(row[labelKey])}: ${formatCell(row[valueKey])}`}</title>
            </circle>
          )
          offset += dash
          return segment
        }) : null}
        <text x={100} y={96} textAnchor="middle" className="insight-donut-total">{numberFormat.format(total)}</text>
        <text x={100} y={118} textAnchor="middle" className="insight-tick">合計</text>
      </svg>
      <ul className="insight-legend insight-legend-column">
        {rows.map((row, index) => (
          <li key={index}>
            <span style={{ background: PALETTE[index % PALETTE.length] }} />
            {formatCell(row[labelKey])}
            <strong>{formatCell(row[valueKey])}</strong>
            <small>{total ? `${Math.round((num(row[valueKey]) / total) * 100)}%` : '—'}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const { registry: insightsRegistry } = defineRegistry(insightsCatalog, {
  components: {
    Stack: ({ props, children }) => (
      <div className={props.direction === 'horizontal' ? 'insight-stack insight-stack-row' : 'insight-stack'}>{children}</div>
    ),
    Grid: ({ props, children }) => (
      <div className="insight-grid" style={{ ['--insight-columns' as string]: String(props.columns ?? 3) }}>{children}</div>
    ),
    Heading: ({ props }) => {
      const level = props.level ?? '2'
      return level === '1' ? <h2 className="insight-h1">{props.text}</h2>
        : level === '3' ? <h4 className="insight-h3">{props.text}</h4>
          : <h3 className="insight-h2">{props.text}</h3>
    },
    Text: ({ props }) => <p className={props.tone === 'muted' ? 'insight-text insight-muted' : 'insight-text'}>{props.text}</p>,
    Callout: ({ props }) => (
      <div className={`insight-callout insight-callout-${props.tone ?? 'info'}`}>
        {props.tone === 'warning' ? <TriangleAlert size={16} /> : <Info size={16} />}
        <span>{props.text}</span>
      </div>
    ),
    Metric: ({ props }) => (
      <div className="metric">
        <span>{props.label}</span>
        <strong>
          {typeof props.value === 'number' ? numberFormat.format(props.value) : (props.value ?? '—')}
          {props.unit ? <small className="insight-unit">{props.unit}</small> : null}
        </strong>
        {props.detail ? <small>{props.detail}</small> : null}
      </div>
    ),
    BarChart: ({ props }) => {
      const rows = asRows(props.data)
      return (
        <ChartFrame title={props.title} legend={props.series}>
          {rows.length === 0 ? <EmptyChart />
            : props.orientation === 'horizontal'
              ? <HorizontalBars rows={rows} xKey={props.xKey} series={props.series} />
              : <VerticalBars rows={rows} xKey={props.xKey} series={props.series} stacked={props.stacked ?? false} />}
        </ChartFrame>
      )
    },
    LineChart: ({ props }) => {
      const rows = asRows(props.data)
      return (
        <ChartFrame title={props.title} legend={props.series}>
          {rows.length === 0 ? <EmptyChart /> : <Lines rows={rows} xKey={props.xKey} series={props.series} />}
        </ChartFrame>
      )
    },
    DonutChart: ({ props }) => {
      const rows = asRows(props.data)
      return (
        <ChartFrame title={props.title}>
          {rows.length === 0 ? <EmptyChart /> : <Donut rows={rows} labelKey={props.labelKey} valueKey={props.valueKey} />}
        </ChartFrame>
      )
    },
    Table: ({ props }) => {
      const rows = asRows(props.data)
      const numeric = (key: string) => rows.length > 0 && rows.every(row => typeof row[key] === 'number')
      return (
        <figure className="insight-table">
          {props.title ? <figcaption>{props.title}</figcaption> : null}
          <table>
            <thead>
              <tr>
                {props.columns.map(column => (
                  <th key={column.key} className={(column.align ?? (numeric(column.key) ? 'right' : 'left')) === 'right' ? 'num' : ''}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {props.columns.map(column => (
                    <td key={column.key} className={(column.align ?? (numeric(column.key) ? 'right' : 'left')) === 'right' ? 'num' : ''}>
                      {formatCell(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {props.showTotal && rows.length > 0 ? (
              <tfoot>
                <tr>
                  {props.columns.map((column, index) => (
                    <td key={column.key} className={numeric(column.key) ? 'num' : ''}>
                      {numeric(column.key)
                        ? numberFormat.format(rows.reduce((sum, row) => sum + num(row[column.key]), 0))
                        : index === 0 ? '合計' : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </figure>
      )
    },
  },
})
