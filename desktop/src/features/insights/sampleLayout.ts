/**
 * A layout in the exact shape the model returns (json-render JSONL patches),
 * for 「今週の予約を曜日別グラフで」. Used by the mock desk and the tests.
 */
const patches = [
  { op: 'add', path: '/root', value: 'main' },
  { op: 'add', path: '/elements/main', value: { type: 'Stack', props: { direction: null }, children: ['title', 'period', 'metrics', 'chart', 'table'] } },
  { op: 'add', path: '/elements/title', value: { type: 'Heading', props: { text: '曜日別の予約数', level: '1' }, children: [] } },
  { op: 'add', path: '/elements/period', value: { type: 'Text', props: { text: { $template: '対象期間: ${/datasets/summary/period}（キャンセル・ノーショーを除く）' }, tone: 'muted' }, children: [] } },
  { op: 'add', path: '/elements/metrics', value: { type: 'Grid', props: { columns: 3 }, children: ['m-groups', 'm-players', 'm-avg'] } },
  { op: 'add', path: '/elements/m-groups', value: { type: 'Metric', props: { label: '予約組数', value: { $state: '/datasets/summary/reservations' }, unit: '組', detail: null }, children: [] } },
  { op: 'add', path: '/elements/m-players', value: { type: 'Metric', props: { label: '来場予定人数', value: { $state: '/datasets/summary/players' }, unit: '名', detail: null }, children: [] } },
  { op: 'add', path: '/elements/m-avg', value: { type: 'Metric', props: { label: '1組あたり', value: { $state: '/datasets/summary/averagePartySize' }, unit: '名', detail: null }, children: [] } },
  { op: 'add', path: '/elements/chart', value: { type: 'BarChart', props: { title: '曜日別 予約組数・人数', data: { $state: '/datasets/byWeekday' }, xKey: 'weekday', series: [{ key: 'reservations', label: '組数' }, { key: 'players', label: '人数' }], stacked: false, orientation: 'vertical' }, children: [] } },
  { op: 'add', path: '/elements/table', value: { type: 'Table', props: { title: '内訳', data: { $state: '/datasets/byWeekday' }, columns: [{ key: 'weekday', label: '曜日', align: null }, { key: 'reservations', label: '組数', align: 'right' }, { key: 'players', label: '人数', align: 'right' }], showTotal: true }, children: [] } },
]

export const SAMPLE_WEEKDAY_LAYOUT = patches.map(patch => JSON.stringify(patch)).join('\n')
