import { courseboardApiBlob, courseboardApiJson } from '../../../api'
import { fileDigest, getJob, type ImportJob, type ImportOptions } from './api'
import { i18next as i18n } from '../../../i18n'

const ROOT = '/v1/course/data-imports'
const OCR_ROOT = '/v1/course/customers/reception-draft/jobs'
export const DOCUMENT_LIMITS = { files: 32, fileBytes: 64 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024, reviewRows: 5000 } as const

export type DocumentSource = { index: number; contentType: string; size: number; sha256: string; rotation: 0 | 90 | 180 | 270 }
export type DocumentRow = { source: { fileIndex: number; page: number; row: number }; values: Record<string, unknown>; excludedReason?: string | null }
export type DocumentRevision = { version: number; sha256: string; rows: DocumentRow[]; options?: ImportOptions }
export type DocumentImport = { rowField?: 'rows' | 'visitors'; executionJobId?: string | null; executionConfirmed?: boolean; validationCursor?: number; ocrJobId: string; manifestSha256: string; sources: DocumentSource[]; pages: string | null; ocrStatus: string; expiresAt: string; revisionVersion: number; revisionSha256: string | null; extracted?: { fields: Record<string, unknown>; warnings: string[] }; revision?: DocumentRevision; executionAvailable: boolean }
type OcrReservation = { id: string; status: string; uploads: { storageKey: string; uploadUrl: string; expiresAt: string }[] }

async function inspect(files: readonly File[], signal: AbortSignal) {
  if (!files.length || files.length > DOCUMENT_LIMITS.files) throw new Error(i18n.t('documentImport:error.files'))
  if (files.some(file => (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) && !(file.type === '' && /\.pdf$/i.test(file.name))) || !file.size || file.size > DOCUMENT_LIMITS.fileBytes)) throw new Error(i18n.t('documentImport:error.size'))
  if (files.reduce((sum, file) => sum + file.size, 0) > DOCUMENT_LIMITS.totalBytes) throw new Error(i18n.t('documentImport:error.total'))
  const contentTypes: string[] = []
  for (const file of files) {
    signal.throwIfAborted()
    // Some browsers omit a PDF's MIME type. Require both its extension and
    // signature before normalizing metadata and the eventual Storage PUT.
    if (!file.type && String.fromCharCode(...new Uint8Array(await file.slice(0, 5).arrayBuffer())) !== '%PDF-') throw new Error(i18n.t('documentImport:error.pdf'))
    contentTypes.push(file.type || 'application/pdf')
  }
  signal.throwIfAborted()
  return contentTypes
}

/** Caller retains idempotencyKey before calling. Retrying a lost reserve/link
 * response resolves the same OCR and transfer jobs, without reading a page.
 * Kept separate from the existing reception entry until PDF migration is ready.
 */
export async function reserveReceptionDocumentImport(files: readonly File[], idempotencyKey: string, signal: AbortSignal) {
  const contentTypes = await inspect(files, signal)
  if (!idempotencyKey.trim() || idempotencyKey.length > 128) throw new Error(i18n.t('documentImport:error.operation'))
  const sheets: { contentType: string; size: number; sha256: string }[] = []
  for (const [index, file] of files.entries()) sheets.push({ contentType: contentTypes[index]!, size: file.size, sha256: await fileDigest(file, signal) })
  signal.throwIfAborted()
  const ocr = await courseboardApiJson<OcrReservation>(OCR_ROOT, { method: 'POST', body: JSON.stringify({ idempotencyKey, sheets }), signal })
  const job = await courseboardApiJson<ImportJob>(`${ROOT}/objects/customerReception/imports/document-link`, { method: 'POST', body: JSON.stringify({ ocrJobId: ocr.id }), signal })
  if (job.document?.ocrJobId !== ocr.id || job.document.sources.length !== sheets.length || job.document.sources.some((source, index) => source.sha256 !== sheets[index]!.sha256 || source.contentType !== sheets[index]!.contentType || source.size !== sheets[index]!.size)) throw new Error(i18n.t('documentImport:error.linkedManifest'))
  return { job, ocr }
}

/** Direct Storage uploads carry no app cookies or Bearer. A resume must use
 * the original ordered files, including content hashes rather than names.
 */
export async function uploadDocumentSources(job: ImportJob, ocr: OcrReservation, files: readonly File[], signal: AbortSignal) {
  const document = job.document
  if (!document || document.ocrJobId !== ocr.id || document.sources.length !== files.length || ocr.uploads.length !== files.length || ocr.status !== 'uploading') throw new Error(i18n.t('documentImport:error.uploadInfo'))
  const contentTypes = await inspect(files, signal)
  // Verify the entire ordered set before the first PUT.
  for (const [index, file] of files.entries()) {
    const source = document.sources[index]!
    if (source.index !== index || source.size !== file.size || source.contentType !== contentTypes[index]! || source.sha256 !== await fileDigest(file, signal)) throw new Error(i18n.t('documentImport:error.sameFiles'))
  }
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted()
    const url = new URL(ocr.uploads[index]!.uploadUrl)
    if (url.protocol !== 'https:') throw new Error(i18n.t('documentImport:error.uploadUrl'))
    const response = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': contentTypes[index]! }, credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4 * 60 * 1000)]) })
    if (!response.ok) throw new Error(i18n.t('documentImport:error.uploadFailed'))
  }
}

/** Reads only through the established OCR executor; synchronization is not a
 * business write or a metering operation. An uncertain read is reconciled
 * through that same ID by its next call, never by a replacement OCR job.
 */
export async function stepDocumentRead(job: ImportJob, operation: 'confirm' | 'advance', signal: AbortSignal) {
  if (!job.document) throw new Error(i18n.t('documentImport:error.document'))
  await courseboardApiJson(`${OCR_ROOT}/${encodeURIComponent(job.document.ocrJobId)}/${operation}`, { method: 'POST', signal })
  return syncDocumentImport(job.id, signal)
}
export function syncDocumentImport(id: string, signal?: AbortSignal) {
  return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encodeURIComponent(id)}/document-sync`, { method: 'POST', signal })
}
export async function saveDocumentRevision(job: ImportJob, rows: DocumentRow[], signal?: AbortSignal, importOptions?: ImportOptions) {
  const document = job.document
  if (!document || document.ocrStatus !== 'completed') throw new Error(i18n.t('documentImport:error.readFirst'))
  if (rows.length > DOCUMENT_LIMITS.reviewRows) throw new Error(i18n.t('documentImport:error.rowsLimit'))
  return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encodeURIComponent(job.id)}/document-revision`, { method: 'POST', signal, body: JSON.stringify({ manifestSha256: document.manifestSha256, expectedVersion: document.revisionVersion, rows, ...(importOptions ? { importOptions } : {}) }) })
}
export { getJob as getDocumentImport }

export type DocumentReadResult = { job: ImportJob; ocr: { id: string; status: string }; uploads: OcrReservation['uploads'] }
export function readReservationDocument(id: string, operation: 'confirm' | 'advance' | 'inspect' | 'uploads' | 'discard', signal?: AbortSignal) {
  return courseboardApiJson<DocumentReadResult>(`${ROOT}/jobs/${encodeURIComponent(id)}/document-read`, { method: 'POST', signal, body: JSON.stringify({ operation }) })
}
export async function reserveReservationDocument(files: readonly File[], rotations: DocumentSource['rotation'][], pages: string, importOptions: ImportOptions, idempotencyKey: string, signal: AbortSignal) {
  const contentTypes = await inspect(files, signal)
  if (contentTypes.some(contentType => contentType !== 'application/pdf') || files.length !== rotations.length) throw new Error(i18n.t('documentImport:error.pdf'))
  const documents: { contentType: string; size: number; sha256: string; rotation: DocumentSource['rotation'] }[] = []
  for (const [index, file] of files.entries()) documents.push({ contentType: contentTypes[index]!, size: file.size, sha256: await fileDigest(file, signal), rotation: rotations[index]! })
  const result = await courseboardApiJson<{ job: ImportJob; ocr: { job: { id: string; status: string }; uploads: OcrReservation['uploads'] } }>(`${ROOT}/objects/courseboardReservationReports/imports/document-upload`, { method: 'POST', signal, body: JSON.stringify({ idempotencyKey, documents, pages: pages.trim() || null, importOptions }) })
  const stored = result.job.document
  if (!stored || stored.ocrJobId !== result.ocr.job.id || stored.sources.length !== documents.length || stored.sources.some((source, i) => source.sha256 !== documents[i]!.sha256 || source.size !== documents[i]!.size || source.rotation !== documents[i]!.rotation || source.contentType !== documents[i]!.contentType)) throw new Error(i18n.t('documentImport:error.manifest'))
  return { job: result.job, ocr: { ...result.ocr.job, uploads: result.ocr.uploads } }
}
function executionBody(job: ImportJob) {
  const doc = job.document
  if (!doc?.revisionSha256 || !doc.revisionVersion) throw new Error(i18n.t('documentImport:error.revision'))
  return JSON.stringify({ manifestSha256: doc.manifestSha256, revisionVersion: doc.revisionVersion, revisionSha256: doc.revisionSha256 })
}
export function executeDocumentRevision(job: ImportJob, operation: 'validate' | 'confirm', signal?: AbortSignal) {
  return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encodeURIComponent(job.id)}/document-${operation}`, { method: 'POST', signal, body: executionBody(job) })
}
export async function fetchDocumentOriginal(job: ImportJob, index: number, signal: AbortSignal) {
  const expected = job.document?.sources[index]
  if (!expected) throw new Error(i18n.t('documentImport:error.manifest'))
  const original = await courseboardApiBlob(`${ROOT}/jobs/${encodeURIComponent(job.id)}/document-original/${index}`, { signal })
  if (original.size > DOCUMENT_LIMITS.fileBytes || original.size !== expected.size || await fileDigest(original, signal) !== expected.sha256) throw new Error(i18n.t('documentImport:error.manifest'))
  return original.type === expected.contentType ? original : new Blob([original], { type: expected.contentType })
}
