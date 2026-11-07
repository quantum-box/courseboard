// @vitest-environment jsdom
import { JSONUIProvider, Renderer } from '@json-render/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildDatasets, type InsightReservation } from './datasets'
import { buildSystemPrompt, compileLayout } from './layoutSpec'
import { periodFor } from './period'
import { insightsRegistry } from './registry'
import { SAMPLE_WEEKDAY_LAYOUT } from './sampleLayout'

const week = periodFor('thisWeek', '2026-11-07') // Saturday

function reservation(teeTime: string, partySize: number, status = 'confirmed', courseName = '東'): InsightReservation {
  return { teeTime, partySize, status, courseName, playType: 'caddie' }
}

describe('periodFor', () => {
  it('runs Monday to Sunday', () => {
    expect(week).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(periodFor('lastWeek', '2026-11-02')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(periodFor('thisMonth', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('buildDatasets', () => {
  const items = [
    reservation('2026-11-02T07:00:00+09:00', 4), // Mon
    reservation('2026-11-07T07:10:00+09:00', 3), // Sat
    reservation('2026-11-07T08:00:00+09:00', 2, 'cancelled'),
    reservation('2026-11-08T00:30:00+09:00', 4, 'no_show'),
    // 23:30 UTC on Sunday is Monday in Tokyo, outside the week.
    reservation('2026-11-08T23:30:00Z', 4),
  ]
  const datasets = buildDatasets(items, week, 'Asia/Tokyo')

  it('counts weekdays in the tenant zone and excludes groups that did not play', () => {
    expect(datasets.summary).toMatchObject({ reservations: 2, players: 7, cancelled: 1, noShow: 1 })
    expect(datasets.byWeekday.map(row => row.weekday)).toEqual(['月', '火', '水', '木', '金', '土', '日'])
    expect(datasets.byWeekday.find(row => row.weekday === '土')).toMatchObject({ reservations: 1, players: 3 })
    expect(datasets.byWeekday.find(row => row.weekday === '火')).toMatchObject({ reservations: 0, players: 0 })
  })

  it('keeps every day so a quiet day still reads 0', () => {
    expect(datasets.byDate).toHaveLength(7)
    expect(datasets.byDate[0]).toEqual({ date: '11/2(月)', reservations: 1, players: 4 })
  })

  it('tells the model shapes, never values', () => {
    const prompt = buildSystemPrompt(datasets)
    expect(prompt).toContain('/datasets/byWeekday')
    expect(prompt).toContain('NEVER output any /state patch')
    expect(prompt).not.toMatch(/"reservations":\s*\d/)
  })
})

describe('compileLayout', () => {
  it('compiles the sample answer without warnings', () => {
    const { spec, warnings } = compileLayout(SAMPLE_WEEKDAY_LAYOUT)
    expect(warnings).toEqual([])
    expect(spec?.elements.chart?.type).toBe('BarChart')
  })

  it('drops state the model writes and replaces literal numbers with a warning', () => {
    const text = [
      { op: 'add', path: '/root', value: 'main' },
      { op: 'add', path: '/elements/main', value: { type: 'Stack', props: {}, children: ['fake', 'claim', 'ok'] } },
      { op: 'add', path: '/elements/fake', value: { type: 'BarChart', props: { title: null, data: [{ weekday: '月', reservations: 99 }], xKey: 'weekday', series: [] }, children: [] } },
      { op: 'add', path: '/elements/claim', value: { type: 'Text', props: { text: '土曜は42組で最多です' }, children: [] } },
      { op: 'add', path: '/elements/ok', value: { type: 'Metric', props: { label: '組数', value: { $state: '/datasets/summary/reservations' } }, children: [] } },
      { op: 'add', path: '/state/datasets', value: { summary: { reservations: 1000 } } },
    ].map(patch => JSON.stringify(patch)).join('\n')
    const { spec, warnings } = compileLayout(text)
    expect(spec?.elements.fake?.type).toBe('Callout')
    expect(spec?.elements.claim?.type).toBe('Callout')
    expect(spec?.elements.ok?.type).toBe('Metric')
    expect(spec?.state).toBeUndefined()
    expect(warnings.some(warning => warning.includes('state パッチ 1 件'))).toBe(true)
  })

  it('reports an answer that is not a layout', () => {
    expect(compileLayout('すみません、わかりません').spec).toBeNull()
  })
})

describe('rendering', () => {
  it('draws the counted numbers, not anything from the model', () => {
    const datasets = buildDatasets([
      reservation('2026-11-07T07:10:00+09:00', 3),
      reservation('2026-11-07T07:20:00+09:00', 4),
      reservation('2026-11-03T09:00:00+09:00', 2),
    ], week, 'Asia/Tokyo')
    const { spec } = compileLayout(SAMPLE_WEEKDAY_LAYOUT)
    render(
      <JSONUIProvider registry={insightsRegistry} initialState={{ datasets }}>
        <Renderer spec={spec} registry={insightsRegistry} />
      </JSONUIProvider>,
    )
    expect(screen.getByText('曜日別の予約数')).toBeTruthy()
    expect(screen.getByText('対象期間: 11/2(月)〜11/8(日)（キャンセル・ノーショーを除く）')).toBeTruthy()
    // Table total row: 3 groups, 9 players.
    const total = screen.getByText('合計').closest('tr')
    expect(total?.textContent).toBe('合計39')
  })
})

describe('every chart type', () => {
  it('renders line, donut and horizontal bars from bound datasets', () => {
    const datasets = buildDatasets([
      reservation('2026-11-07T07:10:00+09:00', 3, 'confirmed', '東'),
      reservation('2026-11-05T09:00:00+09:00', 2, 'confirmed', '西'),
    ], week, 'Asia/Tokyo')
    const text = [
      { op: 'add', path: '/root', value: 'main' },
      { op: 'add', path: '/elements/main', value: { type: 'Grid', props: { columns: 2 }, children: ['line', 'donut', 'hbar'] } },
      { op: 'add', path: '/elements/line', value: { type: 'LineChart', props: { title: '日別推移', data: { $state: '/datasets/byDate' }, xKey: 'date', series: [{ key: 'reservations', label: '組数' }] }, children: [] } },
      { op: 'add', path: '/elements/donut', value: { type: 'DonutChart', props: { title: 'プレー区分', data: { $state: '/datasets/byPlayType' }, labelKey: 'playType', valueKey: 'count' }, children: [] } },
      { op: 'add', path: '/elements/hbar', value: { type: 'BarChart', props: { title: 'コース別', data: { $state: '/datasets/byCourse' }, xKey: 'course', series: [{ key: 'reservations', label: '組数' }], stacked: null, orientation: 'horizontal' }, children: [] } },
    ].map(patch => JSON.stringify(patch)).join('\n')
    const { spec, warnings } = compileLayout(text)
    expect(warnings).toEqual([])
    render(
      <JSONUIProvider registry={insightsRegistry} initialState={{ datasets }}>
        <Renderer spec={spec} registry={insightsRegistry} />
      </JSONUIProvider>,
    )
    expect(screen.getByText('日別推移')).toBeTruthy()
    expect(screen.getByText('キャディ付き')).toBeTruthy()
    expect(screen.getByText('西')).toBeTruthy()
  })
})
