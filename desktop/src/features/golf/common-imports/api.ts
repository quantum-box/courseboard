import type { DocumentImport } from './document-api'
import { sha256 } from '@noble/hashes/sha2.js'
import { courseboardApiBlob, courseboardApiJson, downloadBlob } from '../../../api'

export const MAX_PREVIEW_IMPORT_BYTES = 3_000_000
const ROOT = '/v1/course/data-imports'
export type ImportMode = 'create_only' | 'update_only' | 'upsert'
export type ImportOptions = { year?: number; courseMappings?: Record<string, string>; columnMappings?: Record<string, string>; sourceApp?: string }
export type ImportTarget = { key: string; label: string; import: { fields: { key: string; label: string; aliases: string[] }[]; writable: boolean }; importModes: ImportMode[]; documentImport?: { pricingStatus: 'undecided'; maxSources: number; maxSourceBytes: number; maxTotalBytes: number; maxSelectedPdfPages: number; maxReviewRows: number; retentionHours: number } }
export type ImportRow = { rowNumber: number; object: Record<string, unknown>; warnings: unknown[]; error: string | null; outcome: string | null }
export type ImportJob = { document?: DocumentImport; sourceUploadUrl?: string; sourceContentType?: string; id: string; objectKey: string; status: string; mode: ImportMode; processed: number; total: number | null; created: number; updated: number; errors: number; validationErrors: unknown[]; preview: ImportRow[]; batch: boolean; previewPage: number; previewPages: number; filename: string | null; failure: string | null; importOptions: ImportOptions; sourceSha256: string; createdAt: string }
export const targetLabels: Record<string, string> = { customer: '顧客台帳', dailyBudgets: '日次予算', courseboardReservationReports: '予約表集計' }
export const statusLabels: Record<string, string> = { uploading: 'アップロード中', validating: '全行を検証中', review: '原本・修正を確認中', ready: '実行確認待ち', running: '取込中', invalid: '入力を修正してください', cancelled: '中止', completed: '完了', completed_with_errors: '一部の行でエラー' }
export function batchImportLimit(filename: string) { return /\.csv$/iu.test(filename) ? 1024 * 1024 * 1024 : 32 * 1024 * 1024 }
const encoded = (id: string) => encodeURIComponent(id)
export async function listTargets(signal?: AbortSignal) { return (await courseboardApiJson<{ items: ImportTarget[] }>(`${ROOT}/objects`, { signal })).items }
export async function listJobs(signal?: AbortSignal) { return (await courseboardApiJson<{ items: ImportJob[] }>(`${ROOT}/jobs`, { signal })).items }
export function getJob(id: string, signal?: AbortSignal) { return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encoded(id)}`, { signal }) }
export function getPreview(id: string, page: number, signal?: AbortSignal) { return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encoded(id)}/preview/${page}`, { signal }) }
export function stepJob(id: string, operation: 'advance' | 'validate' | 'cancel' | 'resume', signal?: AbortSignal) { return courseboardApiJson<ImportJob>(`${ROOT}/jobs/${encoded(id)}/${operation}`, { method: 'POST', signal }) }
export async function downloadTemplate(key: string, format: 'csv' | 'excel') {
  const blob = await courseboardApiBlob(`${ROOT}/objects/${encoded(key)}/template?format=${format}`)
  await downloadBlob(`${targetLabels[key]}-テンプレート.${format === 'csv' ? 'csv' : 'xlsx'}`, blob)
}
function dataUrl(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const reader = new FileReader()
    const abort = () => reader.abort()
    const cleanup = () => signal?.removeEventListener('abort', abort)
    reader.onload = () => { cleanup(); resolve(String(reader.result).split(',')[1] ?? '') }
    reader.onerror = () => { cleanup(); reject(new Error('ファイルを読み込めませんでした。')) }
    reader.onabort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    reader.readAsDataURL(file)
  })
}
export async function fileDigest(file: Blob, signal?: AbortSignal): Promise<string> {
  const hash = sha256.create()
  for (let offset = 0; offset < file.size; offset += 8 * 1024 * 1024) {
    signal?.throwIfAborted()
    hash.update(new Uint8Array(await file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer()))
  }
  signal?.throwIfAborted()
  return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function previewImport(key: string, file: File, mode: ImportMode, importOptions: ImportOptions, idempotencyKey: string, signal?: AbortSignal) {
  if (file.size > MAX_PREVIEW_IMPORT_BYTES) throw new Error('大容量ファイルは分割取込で検証してください。')
  const contentBase64 = await dataUrl(file, signal)
  signal?.throwIfAborted()
  return courseboardApiJson<ImportJob>(`${ROOT}/objects/${encoded(key)}/imports/preview`, { method: 'POST', signal, body: JSON.stringify({ filename: file.name, contentBase64, mode, importOptions, idempotencyKey }) })
}
export async function uploadImport(key: string, file: File, mode: ImportMode, importOptions: ImportOptions, idempotencyKey: string, signal: AbortSignal, onReserved: (job: ImportJob) => void) {
  const digest = await fileDigest(file, signal)
  const reserved = await courseboardApiJson<{ job: ImportJob; uploadUrl: string; contentType: string }>(`${ROOT}/objects/${encoded(key)}/imports/upload-url`, {
    method: 'POST', signal, body: JSON.stringify({ filename: file.name, size: file.size, sha256: digest, mode, importOptions, idempotencyKey }),
  })
  signal.throwIfAborted()
  onReserved(reserved.job)
  const url = new URL(reserved.uploadUrl)
  if (url.protocol !== 'https:' && !(import.meta.env.DEV && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('アップロード先が不正です。')
  const response = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': reserved.contentType }, credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4 * 60 * 1000)]) })
  if (!response.ok) throw new Error('ファイルをアップロードできませんでした。元のファイルで再試行してください。')
  signal.throwIfAborted()
  return reserved.job
}
export function issueMessage(issue: unknown) { return typeof issue === 'string' ? issue : issue && typeof issue === 'object' && 'message' in issue ? String(issue.message) : '入力値を確認してください。' }

export async function reuploadSource(job: ImportJob, file: File, signal: AbortSignal) {
  if (!job.sourceUploadUrl || !job.sourceContentType || await fileDigest(file, signal) !== job.sourceSha256) throw new Error('取込を開始したときと同じファイルを選択してください。')
  const url = new URL(job.sourceUploadUrl)
  if (url.protocol !== 'https:' && !(import.meta.env.DEV && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('アップロード先が不正です。')
  const response = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': job.sourceContentType }, credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4 * 60 * 1000)]) })
  if (!response.ok) throw new Error('元のファイルをアップロードできませんでした。再試行してください。')
}
