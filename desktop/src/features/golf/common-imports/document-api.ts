import { courseboardApiJson } from '../../../api'
import { fileDigest, getJob, type ImportJob } from './api'

const ROOT = '/v1/course/data-imports'
const OCR_ROOT = '/v1/course/customers/reception-draft/jobs'
export const DOCUMENT_LIMITS = { files: 32, fileBytes: 64 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024, reviewRows: 5000 } as const

export type DocumentSource = { index: number; contentType: string; size: number; sha256: string; rotation: 0 }
export type DocumentRow = { source: { fileIndex: number; page: number; row: number }; values: Record<string, unknown>; excludedReason?: string | null }
export type DocumentRevision = { version: number; sha256: string; rows: DocumentRow[] }
export type DocumentImport = { ocrJobId: string; manifestSha256: string; sources: DocumentSource[]; pages: string | null; ocrStatus: string; expiresAt: string; revisionVersion: number; revisionSha256: string | null; extracted?: { fields: Record<string, unknown>; warnings: string[] }; revision?: DocumentRevision; executionAvailable: false }
type OcrReservation = { id: string; status: string; uploads: { storageKey: string; uploadUrl: string; expiresAt: string }[] }

function inspect(files: readonly File[]) {
  if (!files.length || files.length > DOCUMENT_LIMITS.files) throw new Error('1回の文書取込は1〜32ファイルで選択してください。')
  if (files.some(file => !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > DOCUMENT_LIMITS.fileBytes)) throw new Error('PDF・JPEG・PNGを1ファイル64 MiB以下で選択してください。')
  if (files.reduce((sum, file) => sum + file.size, 0) > DOCUMENT_LIMITS.totalBytes) throw new Error('選択した文書の合計は1 GiBまでです。')
}

/** Caller retains idempotencyKey before calling. Retrying a lost reserve/link
 * response resolves the same OCR and transfer jobs, without reading a page.
 * Kept separate from the existing reception entry until PDF migration is ready.
 */
export async function reserveReceptionDocumentImport(files: readonly File[], idempotencyKey: string, signal: AbortSignal) {
  inspect(files)
  if (!idempotencyKey.trim() || idempotencyKey.length > 128) throw new Error('再開用の操作IDを指定してください。')
  const sheets: { contentType: string; size: number; sha256: string }[] = []
  for (const file of files) sheets.push({ contentType: file.type, size: file.size, sha256: await fileDigest(file, signal) })
  signal.throwIfAborted()
  const ocr = await courseboardApiJson<OcrReservation>(OCR_ROOT, { method: 'POST', body: JSON.stringify({ idempotencyKey, sheets }), signal })
  const job = await courseboardApiJson<ImportJob>(`${ROOT}/objects/customerReception/imports/document-link`, { method: 'POST', body: JSON.stringify({ ocrJobId: ocr.id }), signal })
  if (job.document?.ocrJobId !== ocr.id || job.document.sources.length !== sheets.length || job.document.sources.some((source, index) => source.sha256 !== sheets[index]!.sha256 || source.contentType !== sheets[index]!.contentType || source.size !== sheets[index]!.size)) throw new Error('保存された原本情報が一致しません。同じ操作IDで状態を確認してください。')
  return { job, ocr }
}

/** Direct Storage uploads carry no app cookies or Bearer. A resume must use
 * the original ordered files, including content hashes rather than names.
 */
export async function uploadDocumentSources(job: ImportJob, ocr: OcrReservation, files: readonly File[], signal: AbortSignal) {
  const document = job.document
  if (!document || document.ocrJobId !== ocr.id || document.sources.length !== files.length || ocr.uploads.length !== files.length || ocr.status !== 'uploading') throw new Error('元の文書ジョブのアップロード情報を取得し直してください。')
  // Verify the entire ordered set before the first PUT.
  for (const [index, file] of files.entries()) {
    const source = document.sources[index]!
    if (source.index !== index || source.size !== file.size || source.contentType !== file.type || source.sha256 !== await fileDigest(file, signal)) throw new Error('取込開始時と同じ文書を同じ順序で選択してください。')
  }
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted()
    const url = new URL(ocr.uploads[index]!.uploadUrl)
    if (url.protocol !== 'https:') throw new Error('文書のアップロード先が不正です。')
    const response = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type }, credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4 * 60 * 1000)]) })
    if (!response.ok) throw new Error('アップロードに失敗しました。同じ文書ジョブから再開してください。')
  }
}

/** Reads only through the established OCR executor; synchronization is not a
 * business write or a metering operation. An uncertain read is reconciled
 * through that same ID by its next call, never by a replacement OCR job.
 */
export async function stepDocumentRead(job: ImportJob, operation: 'confirm' | 'advance', signal: AbortSignal) {
  if (!job.document) throw new Error('文書ジョブを取得してください。')
  await courseboardApiJson(`${OCR_ROOT}/${encodeURIComponent(job.document.ocrJobId)}/${operation}`, { method: 'POST', signal })
  return syncDocumentImport(job.id, signal)
}
export function syncDocumentImport(id: string, signal?: AbortSignal) {
  return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encodeURIComponent(id)}/document-sync`, { method: 'POST', signal })
}
export async function saveDocumentRevision(job: ImportJob, rows: DocumentRow[], signal?: AbortSignal) {
  const document = job.document
  if (!document || document.ocrStatus !== 'completed') throw new Error('読取完了後に原本を確認してください。')
  if (rows.length > DOCUMENT_LIMITS.reviewRows) throw new Error('修正結果の行数が上限を超えています。行を省略せず確認してください。')
  return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encodeURIComponent(job.id)}/document-revision`, { method: 'POST', signal, body: JSON.stringify({ manifestSha256: document.manifestSha256, expectedVersion: document.revisionVersion, rows }) })
}
export { getJob as getDocumentImport }
