import type { DocumentImport, DocumentRow } from './document-api'
import { i18next } from '../../../i18n'

export const reservationFields = ['facilityName', 'date', 'dayPart', 'groupCount', 'caddieAttachedGroupCount'] as const
export type ReservationField = typeof reservationFields[number]
export type ReservationValues = Record<ReservationField, string>
const aliases: Record<ReservationField, string[]> = {
  facilityName: ['facilityName', 'sourceCourseName', '施設名', 'コース', 'ゴルフ場'],
  date: ['date', '日付', '営業日'], dayPart: ['dayPart', '午前・午後', '午前午後', '時間帯'],
  groupCount: ['groupCount', '組数', '予約組数'],
  caddieAttachedGroupCount: ['caddieAttachedGroupCount', 'キャディ付き組数', 'キャディ付組数'],
}
export function sourceCells(row: DocumentRow): Record<string, string> {
  try {
    const cells: unknown = JSON.parse(String(row.values.cells ?? '{}'))
    if (cells && typeof cells === 'object' && !Array.isArray(cells)) return Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, String(value ?? '')]))
  } catch { /* Unreadable original is retained for manual entry or exclusion. */ }
  return {}
}
export function mappedValues(row: DocumentRow, mappings: Record<string, string> = {}): ReservationValues {
  const cells = sourceCells(row)
  return Object.fromEntries(reservationFields.map(field => {
    const column = mappings[field] || aliases[field].find(alias => alias in cells)
    let value = column ? cells[column] ?? '' : ''
    if (field === 'dayPart') value = /^(午前|AM|morning)$/iu.test(value) ? 'morning' : /^(午後|PM|afternoon)$/iu.test(value) ? 'afternoon' : value
    return [field, value]
  })) as ReservationValues
}
export function reviewedRows(document: DocumentImport): DocumentRow[] {
  if (document.revision) return structuredClone(document.revision.rows)
  const raw = document.extracted?.fields[document.rowField ?? 'rows']
  if (!Array.isArray(raw)) return []
  return raw.map((value: Record<string, unknown>) => {
    const row: DocumentRow = { source: { fileIndex: Number(value._source_index), page: Number(value._source_page), row: Number(value._source_row) }, values: structuredClone(value) }
    if (!Number.isInteger(row.source.fileIndex) || row.source.fileIndex < 0 || !document.sources[row.source.fileIndex] || !Number.isInteger(row.source.page) || row.source.page < 1 || !Number.isInteger(row.source.row) || row.source.row < 1) throw new Error(i18next.t('documentImport:error.manifest'))
    row.values.normalized = mappedValues(row)
    row.values.originalConfirmed = false
    return row
  })
}
export function businessValues(row: DocumentRow): ReservationValues[] {
  const values = Array.isArray(row.values.manualRows) ? row.values.manualRows : [row.values.normalized ?? mappedValues(row)]
  return values.map(value => Object.fromEntries(reservationFields.map(field => [field, String((value as Record<string, unknown>)?.[field] ?? '')])) as ReservationValues)
}
export function remapReviewedRow(row: DocumentRow, previous: Record<string, string>, next: Record<string, string>): DocumentRow {
  const before = mappedValues(row, previous), after = mappedValues(row, next)
  const normalized = businessValues(row)[0]!
  const edited = Array.isArray(row.values.editedFields) ? row.values.editedFields : []
  return { ...row, values: { ...row.values, originalConfirmed: false, normalized: Object.fromEntries(reservationFields.map(field => [field, edited.includes(field) || normalized[field] !== before[field] ? normalized[field] : after[field]])) } }
}
export type DocumentUploadSnapshot = { year: number; pages: string; rotations: Array<0 | 90 | 180 | 270> }
export type DocumentOperation = { idempotencyKey: string; jobId?: string; upload?: DocumentUploadSnapshot }
export function operationStorageKey(tenant: string, platform: string, actor: string) { return `courseboard.document-operation:${tenant}:${platform}:${actor}` }
function validateDocumentOperation(value: unknown): asserts value is DocumentOperation {
  if (!value || typeof value !== 'object' || !('idempotencyKey' in value) || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey || value.idempotencyKey.length > 128 || ('jobId' in value && (typeof value.jobId !== 'string' || !/^dtj_[A-Za-z0-9_]+$/u.test(value.jobId)))) throw new Error(i18next.t('documentImport:error.storage'))
  if ('upload' in value) {
    const upload = value.upload
    if (!upload || typeof upload !== 'object' || !('year' in upload) || typeof upload.year !== 'number' || !Number.isInteger(upload.year) || upload.year < 1900 || upload.year > 9999 || !('pages' in upload) || typeof upload.pages !== 'string' || upload.pages.length > 256 || !('rotations' in upload) || !Array.isArray(upload.rotations) || !upload.rotations.length || upload.rotations.length > 32 || upload.rotations.some(rotation => ![0, 90, 180, 270].includes(rotation))) throw new Error(i18next.t('documentImport:error.storage'))
  }
}
export function readDocumentOperation(key: string): DocumentOperation | null {
  let raw: string | null
  try { raw = localStorage.getItem(key) } catch { throw new Error(i18next.t('documentImport:error.storage')) }
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error(i18next.t('documentImport:error.storage')) }
  validateDocumentOperation(value)
  return value
}
export function persistDocumentOperation(key: string, value: DocumentOperation) {
  validateDocumentOperation(value)
  try {
    localStorage.setItem(key, JSON.stringify(value))
    if (localStorage.getItem(key) !== JSON.stringify(value)) throw new Error()
  } catch { throw new Error(i18next.t('documentImport:error.storage')) }
}
