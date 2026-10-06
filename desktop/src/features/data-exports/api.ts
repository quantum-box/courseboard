import { ApiError, downloadBlob, fieldApiJson, fieldApiText, today } from '../../api'
import { i18next } from '../../i18n'

const BASE_PATH = '/v1/bridge/exports'

export type ExportObject = {
  key: string
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
    fieldApiJson<{ items: ExportObject[] }>(`${BASE_PATH}/objects`),
    fieldApiJson<{ items: ExportDefinition[] }>(`${BASE_PATH}/definitions`),
  ])
  return { objects: objects.items, definitions: definitions.items }
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

export async function downloadExportCsv(definition: ExportDefinition) {
  if (definition.status !== 'active' || definition.destinationType !== 'csv') {
    throw new Error(i18next.t('dataExports:inactiveHint'))
  }
  const csv = await fieldApiText(
    `${BASE_PATH}/definitions/${encodeURIComponent(definition.id)}/csv`,
    { signal: AbortSignal.timeout(90_000) },
  )
  const name = definition.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_') || 'export'
  await downloadBlob(
    `${name}_${today()}.csv`,
    new Blob(['\uFEFF', csv.replace(/^\uFEFF/, '')], { type: 'text/csv;charset=utf-8' }),
  )
}

export function exportErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 403) return i18next.t('dataExports:error.forbidden')
    if (error.status === 404) return i18next.t('dataExports:error.notFound')
    if (error.status === 400) return i18next.t('dataExports:error.invalid')
  }
  return fallback
}
