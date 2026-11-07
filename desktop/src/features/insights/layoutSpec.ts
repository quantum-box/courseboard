import {
  applySpecStreamPatch,
  autoFixSpec,
  parseSpecStreamLine,
  validateSpec,
  type Spec,
  type UIElement,
} from '@json-render/core'
import { insightsCatalog } from './catalog'
import { describeDatasets, type InsightDatasets } from './datasets'

/**
 * Rules appended last so they win over json-render's generic prompt, which
 * asks for "realistic sample data" — exactly what a booking report must not
 * contain.
 */
const INSIGHT_RULES = [
  'You are laying out an answer for golf-course front-desk staff. Write every label, heading and sentence in Japanese.',
  'The state model is ALREADY populated with real data under /datasets (listed below). NEVER output any /state patch and NEVER invent sample data. This overrides the earlier rules about sample data.',
  'Every number shown must come from /datasets. Bind data props as { "$state": "/datasets/<name>" } and Metric.value as { "$state": "/datasets/summary/<field>" }. Never write a number literally in data, value, text or labels.',
  'You do not know the values. Do not claim which item is largest, smallest, rising or falling. If you want a sentence that includes a number, use { "$template": "...${/datasets/summary/reservations}..." }.',
  'Answer the question with the fewest components that answer it: usually a Heading, 1–3 Metrics in a Grid, the one chart that fits, and optionally a Table of the same dataset.',
  'If the datasets cannot answer part of the question (e.g. revenue, weather, a different period), say so in a Callout instead of approximating. The period is fixed by the screen, not by you.',
]

export function buildSystemPrompt(datasets: InsightDatasets) {
  return [
    insightsCatalog.prompt({ customRules: INSIGHT_RULES }),
    '',
    'AVAILABLE DATASETS (already in state; shape only, values withheld):',
    describeDatasets(datasets),
  ].join('\n')
}

export type CompiledLayout = {
  spec: Spec | null
  /** Things the guard removed or the model got wrong, for the debug panel. */
  warnings: string[]
}

const DATA_PROPS: Record<string, string[]> = {
  BarChart: ['data'],
  LineChart: ['data'],
  DonutChart: ['data'],
  Table: ['data'],
  Metric: ['value'],
}

const PROSE_PROPS: Record<string, string[]> = {
  Text: ['text'],
  Callout: ['text'],
  Metric: ['detail'],
}

function isDatasetBinding(value: unknown) {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { $state?: unknown }).$state === 'string'
    && (value as { $state: string }).$state.startsWith('/datasets/')
}

function isTemplate(value: unknown) {
  return typeof value === 'object' && value !== null && '$template' in value
}

/**
 * Keep the model's layout, but never its numbers: a data prop that is not
 * bound to a dataset, or prose with a digit it could not have known, is
 * replaced by a visible warning instead of being drawn.
 */
function guardElement(key: string, element: UIElement, warnings: string[]): UIElement {
  for (const prop of DATA_PROPS[element.type] ?? []) {
    const value = (element.props ?? {})[prop]
    if (!isDatasetBinding(value) && !(prop === 'value' && isTemplate(value))) {
      warnings.push(`${key}: ${element.type}.${prop} は /datasets に紐付いていないため表示しませんでした`)
      return warningElement(element)
    }
  }
  for (const prop of PROSE_PROPS[element.type] ?? []) {
    const value = (element.props ?? {})[prop]
    if (typeof value === 'string' && /[0-9０-９]/.test(value)) {
      warnings.push(`${key}: ${element.type}.${prop} に根拠のない数値が含まれていたため表示しませんでした`)
      return warningElement(element)
    }
  }
  return element
}

function warningElement(original: UIElement): UIElement {
  return {
    type: 'Callout',
    props: { text: 'この部分はデータに基づかない値を含んでいたため表示していません。', tone: 'warning' },
    children: [],
    ...(original.visible !== undefined ? { visible: original.visible } : {}),
  }
}

export function compileLayout(text: string): CompiledLayout {
  const warnings: string[] = []
  const raw: Spec = { root: '', elements: {} }
  let droppedState = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('```')) continue
    const patch = parseSpecStreamLine(trimmed)
    if (!patch) continue
    // The state is ours. A model that writes to it is trying to supply numbers.
    if (patch.path === '/state' || patch.path.startsWith('/state/')) {
      droppedState += 1
      continue
    }
    try {
      applySpecStreamPatch(raw as unknown as Record<string, unknown>, patch)
    } catch {
      warnings.push(`適用できないパッチを無視しました: ${trimmed.slice(0, 80)}`)
    }
  }
  if (droppedState) warnings.push(`モデルが出力した state パッチ ${droppedState} 件を破棄しました`)
  if (!raw.root || !raw.elements[raw.root]) {
    warnings.push('レイアウトのルート要素がありません')
    return { spec: null, warnings }
  }
  const { spec: fixed, fixes } = autoFixSpec(raw)
  warnings.push(...fixes)
  const guarded: Spec = {
    root: fixed.root,
    elements: Object.fromEntries(
      Object.entries(fixed.elements).map(([key, element]) => [key, guardElement(key, element, warnings)]),
    ),
  }
  const validation = validateSpec(guarded)
  for (const issue of validation.issues) warnings.push(issue.message)
  return { spec: guarded, warnings }
}
