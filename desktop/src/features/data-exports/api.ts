import { ApiError, courseboardApiJson, downloadBlob, fieldPlatformId, fieldTenant, fieldApiJson, fieldApiText, today } from '../../api'
import { i18next } from '../../i18n'

class DataExportError extends Error {}

const BASE_PATH = '/v1/bridge/exports'

export type ExportObject = {
  key: string
  requiresMonth?: boolean
  label: string
  fields: { field: string; label: string }[]
}

const SOURCE_LABEL_KEYS = {
  reservation: 'dataExports:sourceLabels.reservation',
  salesLedgerDraft: 'dataExports:sourceLabels.sales',
  purchaseLedgerDraft: 'dataExports:sourceLabels.purchases',
  journalLine: 'dataExports:sourceLabels.journal',
  generalLedgerRow: 'dataExports:sourceLabels.generalLedger',
  trialBalanceRow: 'dataExports:sourceLabels.trialBalance',
  arApItem: 'dataExports:sourceLabels.arAp',
} as const

/** Labels are translated locally; availability and fields still come from Field. */
export function exportObjectLabel(object: ExportObject) {
  if (!Object.prototype.hasOwnProperty.call(SOURCE_LABEL_KEYS, object.key)) return object.label
  const key = SOURCE_LABEL_KEYS[object.key as keyof typeof SOURCE_LABEL_KEYS]
  return i18next.t(key)
}

export type ExportMappingField = {
  source: string
  target: string
  required: boolean
  approved: boolean
}

export type ExportDefinition = {
  id: string
  name: string
  description?: string | null
  sourceObject: string
  destinationType: string
  status: string
  mapping: { fields: ExportMappingField[] }
}

export type ExportColumn = {
  field: string
  label: string
  included: boolean
  target: string
}

export type ExportDraft = {
  name: string
  description: string
  sourceObject: string
  status: 'active' | 'inactive'
  columns: ExportColumn[]
}

export function emptyExportDraft(): ExportDraft {
  return { name: '', description: '', sourceObject: '', status: 'active', columns: [] }
}

export function exportDraftError(draft: ExportDraft): string | null {
  if (!draft.name.trim()) return i18next.t('dataExports:validation.name')
  if ([...draft.name.trim()].length > 255) return i18next.t('dataExports:validation.nameTooLong')
  if (!draft.sourceObject) return i18next.t('dataExports:validation.source')
  const columns = draft.columns.filter(column => column.included)
  if (!columns.length) return i18next.t('dataExports:validation.columns')
  if (columns.some(column => !column.target.trim())) return i18next.t('dataExports:validation.header')
  const headers = columns.map(column => column.target.trim())
  if (new Set(headers).size !== headers.length) return i18next.t('dataExports:validation.duplicate')
  return null
}

export async function loadDataExports() {
  const [objects, definitions] = await Promise.all([
    fieldApiJson<{ items: ExportObject[]; clientDataSupported?: boolean }>(`${BASE_PATH}/objects`),
    fieldApiJson<{ items: ExportDefinition[] }>(`${BASE_PATH}/definitions`),
  ])
  const local = objects.clientDataSupported
    ? await courseboardApiJson<{ items: ExportObject[] }>('/v1/course/data-exports/objects')
    : { items: [] }
  return { objects: [...local.items, ...objects.items], definitions: definitions.items }
}

export function createExportDefinition(draft: ExportDraft) {
  const error = exportDraftError(draft)
  if (error) throw new Error(error)
  return fieldApiJson<ExportDefinition>(`${BASE_PATH}/definitions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      sourceObject: draft.sourceObject,
      destinationType: 'csv',
      status: draft.status,
      mapping: {
        fields: draft.columns.filter(column => column.included).map(column => ({
          source: column.field,
          target: column.target.trim(),
          required: false,
          approved: true,
        })),
      },
    }),
  })
}

export async function downloadExportCsv(definition: ExportDefinition, month = today().slice(0, 7)) {
  if (definition.status !== 'active' || definition.destinationType !== 'csv') {
    throw new Error(i18next.t('dataExports:inactiveHint'))
  }
  const scope = `${fieldPlatformId()}:${fieldTenant()}`
  const assertScope = () => {
    if (`${fieldPlatformId()}:${fieldTenant()}` !== scope) throw new DataExportError(i18next.t('dataExports:error.incomplete'))
  }
  const localKey = definition.sourceObject.match(/^external:courseboard:([A-Za-z0-9_-]+)$/)?.[1]
  let csv: string
  if (localKey) {
    const renderPath = `${BASE_PATH}/definitions/${encodeURIComponent(definition.id)}/render`
    const render = async (body: string) => {
      assertScope()
      const result = await fieldApiText(renderPath, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(90_000),
      })
      assertScope()
      return result.replace(/^\uFEFF/, '')
    }
    // Ask Field for its exact header, including quoted newlines and formula
    // escaping, so subsequent parts can be joined without reimplementing CSV.
    const header = await render('{"rows":[]}')
    if (!header) throw new DataExportError(i18next.t('dataExports:error.incomplete'))
    const encoder = new TextEncoder()
    const parts = [header]
    let bytes = encoder.encode(header).length
    let count = 0
    let offset = 0
    do {
      assertScope()
      const page = await courseboardApiJson<{ items: Record<string, unknown>[]; nextOffset: number | null }>(
        `/v1/course/data-exports/${encodeURIComponent(localKey)}/rows?limit=100&offset=${offset}&yearMonth=${encodeURIComponent(month)}`,
        { signal: AbortSignal.timeout(90_000) },
      )
      assertScope()
      count += page.items.length
      if (count > 100_000) throw new DataExportError(i18next.t('dataExports:error.tooLarge'))
      // Each render request fits Field's synchronous request budget. Only the
      // selected columns are sent to the shared renderer.
      for (const body of exportRenderBodies(definition, page.items)) {
        const part = await render(body)
        if (!part.startsWith(header)) throw new DataExportError(i18next.t('dataExports:error.incomplete'))
        const content = part.slice(header.length)
        bytes += encoder.encode(content).length
        if (bytes > 64 * 1024 * 1024) throw new DataExportError(i18next.t('dataExports:error.tooLarge'))
        parts.push(content)
      }
      if (page.nextOffset === null) break
      if (!page.items.length || page.nextOffset <= offset) throw new DataExportError(i18next.t('dataExports:error.incomplete'))
      offset = page.nextOffset
    } while (true)
    csv = parts.join('')
  } else {
    csv = await fieldApiText(`${BASE_PATH}/definitions/${encodeURIComponent(definition.id)}/csv`, { signal: AbortSignal.timeout(90_000) })
  }
  assertScope()
  const name = definition.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_') || 'export'
  await downloadBlob(
    `${name}_${today()}.csv`,
    new Blob(['\uFEFF', csv.replace(/^\uFEFF/, '')], { type: 'text/csv;charset=utf-8' }),
  )
}

function exportRenderBodies(definition: ExportDefinition, rows: Record<string, unknown>[]) {
  const bodies: string[] = []
  let batch: string[] = []
  let bytes = 11
  const encoder = new TextEncoder()
  for (const row of rows) {
    const selected = Object.fromEntries(definition.mapping.fields.map(field => [field.source.trim(), row[field.source.trim()] ?? null]))
    const text = JSON.stringify(selected)
    const size = encoder.encode(text).length + 1
    if (size + 11 > 4_000_000) throw new DataExportError(i18next.t('dataExports:error.tooLarge'))
    if (bytes + size > 4_000_000 && batch.length) {
      bodies.push('{"rows":[' + batch.join(',') + ']}')
      batch = []; bytes = 11
    }
    batch.push(text); bytes += size
  }
  if (batch.length) bodies.push('{"rows":[' + batch.join(',') + ']}')
  return bodies
}

export function exportErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DataExportError) return error.message
  if (error instanceof ApiError) {
    if (error.status === 413) return i18next.t('dataExports:error.tooLarge')
    if (error.status === 403) return i18next.t('dataExports:error.forbidden')
    if (error.status === 404) return i18next.t('dataExports:error.notFound')
    if (error.status === 400) return i18next.t('dataExports:error.invalid')
  }
  return fallback
}
