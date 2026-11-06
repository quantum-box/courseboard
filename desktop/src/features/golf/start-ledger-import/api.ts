import { courseboardApiJson } from '../../../api'
import { i18next as i18n } from '../../../i18n'
import { fileDigest } from '../common-imports/api'
import type { PartyRemarks } from '../ledger/models'

const ROOT = '/v1/course/reservations/start-ledger'
export const START_LEDGER_LIMITS = { files: 8, fileBytes: 64 * 1024 * 1024, importBatch: 10 } as const

export type StartLedgerPlayerDraft = { tag?: string; number?: string; name?: string }
export type StartLedgerPartyDraft = {
  courseName?: string
  teeTime?: string
  playStyle?: 'self' | 'caddie'
  playStyleText?: string
  representative?: string
  groupName?: string
  players: StartLedgerPlayerDraft[]
  planName?: string
  remarks: PartyRemarks
  notes?: string
  copiedFromAbove: string[]
  warnings: string[]
}
export type StartLedgerRead = {
  id: string
  status: 'uploading' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'
  completedUnits: number
  totalUnits?: number
  date?: string
  parties: StartLedgerPartyDraft[]
  warnings: string[]
  failureCode?: string
  expiresAt?: string
}
export type StartLedgerUpload = { storageKey: string; uploadUrl: string; expiresAt: string }
export type StartLedgerContext = {
  courses: { id: string; name: string }[]
  plans: { reservationServiceId: string; name: string; requiresCaddie: boolean; courseIds?: string[] }[]
  booked: { golfCourseId: string; teeTime: string; reservationId: string; customerName?: string }[]
}
export type StartLedgerImportParty = {
  golfCourseId: string
  teeTime: string
  reservationServiceId: string | null
  customerName: string
  quantity: number
  competitionName: string | null
  players: { name: string; tag?: string; memberNumber?: string }[]
  remarks: PartyRemarks
  notes: string | null
}
export type StartLedgerImportResult = { outcome: 'created' | 'already_booked' | 'failed'; reservationId?: string; message?: string; warnings?: string[] }

export const TERMINAL_STATUSES: ReadonlySet<StartLedgerRead['status']> = new Set(['completed', 'failed', 'cancelled', 'expired'])

async function pdfTypes(files: readonly File[], signal: AbortSignal) {
  if (!files.length || files.length > START_LEDGER_LIMITS.files) throw new Error(i18n.t('startLedgerImport:error.files'))
  for (const file of files) {
    signal.throwIfAborted()
    if (!file.size || file.size > START_LEDGER_LIMITS.fileBytes) throw new Error(i18n.t('startLedgerImport:error.size'))
    const header = String.fromCharCode(...new Uint8Array(await file.slice(0, 5).arrayBuffer()))
    if (header !== '%PDF-') throw new Error(i18n.t('startLedgerImport:error.pdf'))
  }
}

/** The caller keeps `idempotencyKey`: a retried create answers the same read. */
export async function createStartLedgerJob(files: readonly File[], idempotencyKey: string, signal: AbortSignal) {
  await pdfTypes(files, signal)
  const documents = []
  for (const file of files) documents.push({ contentType: 'application/pdf', size: file.size, sha256: await fileDigest(file, signal) })
  signal.throwIfAborted()
  return courseboardApiJson<{ job: StartLedgerRead; uploads: StartLedgerUpload[] }>(`${ROOT}/jobs`, { method: 'POST', signal, body: JSON.stringify({ idempotencyKey, documents }) })
}

/** Storage PUTs carry no app cookie or bearer. */
export async function uploadStartLedgerPdfs(files: readonly File[], uploads: readonly StartLedgerUpload[], signal: AbortSignal) {
  if (uploads.length !== files.length) throw new Error(i18n.t('startLedgerImport:error.upload'))
  for (const [index, file] of files.entries()) {
    const url = new URL(uploads[index]!.uploadUrl)
    if (url.protocol !== 'https:' && !(import.meta.env.DEV && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error(i18n.t('startLedgerImport:error.upload'))
    const response = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/pdf' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4 * 60 * 1000)]) })
    if (!response.ok) throw new Error(i18n.t('startLedgerImport:error.upload'))
  }
}

export function stepStartLedgerJob(id: string, step: 'confirm' | 'advance', signal?: AbortSignal) {
  return courseboardApiJson<StartLedgerRead>(`${ROOT}/jobs/${encodeURIComponent(id)}/${step}`, { method: 'POST', signal })
}
export function getStartLedgerJob(id: string, signal?: AbortSignal) {
  return courseboardApiJson<StartLedgerRead>(`${ROOT}/jobs/${encodeURIComponent(id)}`, { signal })
}
export function cancelStartLedgerJob(id: string, signal?: AbortSignal) {
  return courseboardApiJson<StartLedgerRead>(`${ROOT}/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
}
export function getStartLedgerContext(date: string, signal?: AbortSignal) {
  return courseboardApiJson<StartLedgerContext>(`${ROOT}/context?date=${encodeURIComponent(date)}`, { signal })
}
export async function importStartLedgerParties(date: string, parties: StartLedgerImportParty[], signal?: AbortSignal) {
  if (!parties.length || parties.length > START_LEDGER_LIMITS.importBatch) throw new Error(i18n.t('startLedgerImport:error.batch'))
  const response = await courseboardApiJson<{ results: StartLedgerImportResult[] }>(`${ROOT}/import`, { method: 'POST', signal, body: JSON.stringify({ date, parties }) })
  if (response.results.length !== parties.length) throw new Error(i18n.t('startLedgerImport:error.results'))
  return response.results
}

/** Pick up the read this desk was working on after a reload. */
export type StartLedgerOperation = { idempotencyKey: string; jobId?: string }
export function operationKey(tenant: string, platform: string, actor: string) { return `courseboard.start-ledger-operation:${tenant}:${platform}:${actor}` }
export function readOperation(key: string): StartLedgerOperation | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('idempotencyKey' in value) || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey || value.idempotencyKey.length > 128) return null
    const jobId = 'jobId' in value && typeof value.jobId === 'string' ? value.jobId : undefined
    return { idempotencyKey: value.idempotencyKey, ...(jobId ? { jobId } : {}) }
  } catch { return null }
}
export function writeOperation(key: string, operation: StartLedgerOperation | null) {
  try { if (operation) localStorage.setItem(key, JSON.stringify(operation)); else localStorage.removeItem(key) } catch { /* Resume is a convenience; the read itself is kept by Field. */ }
}
