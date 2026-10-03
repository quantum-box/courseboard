import { ApiError, courseboardApiJson } from '../../../../api'
import { customersPath, type Customer } from '../models'
import {
  customerPayload,
  normalizeReceptionFormProposal,
  normalizeReceptionConsentItem,
  normalizeReceptionConsentItems,
  normalizeReceptionFields,
  MAX_RECEPTION_BATCH_SHEETS,
  MAX_RECEPTION_ROWS,
  MAX_RECEPTION_SELECTED_BYTES,
  receptionSheetBatches,
  uploadFileName,
  type ReceptionDraft,
  type ReceptionConsentItem,
  type ReceptionConsentItemWriteInput,
  type ReceptionField,
  type ReceptionFieldWriteInput,
  type ReceptionFormProposal,
  type ReceptionRow,
} from './models'

const RECEPTION_DRAFT_PATH = '/v1/course/customers/reception-draft'
const RECEPTION_DRAFT_JOBS_PATH = `${RECEPTION_DRAFT_PATH}/jobs`
// Field processes at most eight PDF pages per advance, with at most 64 pages
// per source. A 32-source job therefore needs no more than 256 advances.
const MAX_RECEPTION_JOB_ADVANCES = MAX_RECEPTION_BATCH_SHEETS * 8
export const RECEPTION_FIELDS_PATH = '/v1/course/customer-reception-fields'
export const RECEPTION_FIELDS_ANALYSIS_PATH = `${RECEPTION_FIELDS_PATH}/analysis`
export const RECEPTION_CONSENT_ITEMS_PATH = '/v1/course/customer-consent-items'

/** Carries completed OCR work so the failed batch can be retried independently. */
export class ReceptionBatchError extends Error {
  readonly originalError: unknown

  constructor(
    readonly partialDraft: ReceptionDraft,
    readonly nextBatchIndex: number,
    originalError: unknown,
    readonly jobResume?: { idempotencyKey: string; jobId?: string },
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError))
    this.name = 'ReceptionBatchError'
    this.originalError = originalError
  }
}

type ReceptionOcrJob = {
  id: string
  status: 'uploading' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'
  completedUnits: number
  totalUnits?: number | null
  draft: ReceptionDraft
}

type CreatedReceptionOcrJob = ReceptionOcrJob & {
  uploads: Array<{
    storageKey: string
    uploadUrl: string
    expiresAt: string
  }>
}

type ReceptionJobResume = { idempotencyKey: string; jobId?: string }

/**
 * The CourseBoard API returns a complete list (`{ items }`) after merging the
 * tenant's saved rows with defaults. Keep parsing here so the rest of the UI
 * never has to know whether an older local server returned an array directly.
 */
export async function listReceptionFields(): Promise<readonly ReceptionField[]> {
  const response = await courseboardApiJson<unknown>(RECEPTION_FIELDS_PATH)
  return normalizeReceptionFields(response)
}

/** Replace the tenant's reception-field definitions and return the saved list. */
export async function saveReceptionFields(items: readonly ReceptionFieldWriteInput[]) {
  const response = await courseboardApiJson<unknown>(RECEPTION_FIELDS_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  return normalizeReceptionFields(response)
}

/** Read Field's consent catalog; settings includes inactive definitions for dedupe. */
export async function listReceptionConsentItems(options: {
  includeInactive?: boolean
  signal?: AbortSignal
} = {}): Promise<readonly ReceptionConsentItem[]> {
  const query = options.includeInactive ? '?includeInactive=true' : ''
  const response = await courseboardApiJson<unknown>(
    `${RECEPTION_CONSENT_ITEMS_PATH}${query}`,
    options.signal ? { signal: options.signal } : undefined,
  )
  return normalizeReceptionConsentItems(response)
}

/** Create one Field consent definition after the operator confirms its wording. */
export async function createReceptionConsentItem(
  input: ReceptionConsentItemWriteInput,
): Promise<ReceptionConsentItem> {
  const response = await courseboardApiJson<unknown>(RECEPTION_CONSENT_ITEMS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const normalized = normalizeReceptionConsentItem(
    typeof response === 'object' && response !== null && 'item' in response
      ? (response as { item?: unknown }).item
      : response,
  )
  if (!normalized) throw new Error('API response did not contain a consent item')
  return normalized
}

/** Analyze a blank reception sheet and return an unsaved settings proposal. */
export async function analyzeReceptionForm(file: File): Promise<ReceptionFormProposal> {
  const form = new FormData()
  form.append('file', file, uploadFileName(file))
  const response = await courseboardApiJson<unknown>(RECEPTION_FIELDS_ANALYSIS_PATH, {
    method: 'POST',
    body: form,
  })
  return normalizeReceptionFormProposal(response)
}

/**
 * Reads sheets in order, respecting Field's per-request limits. A failed
 * request carries completed batches so the operator can resume at that batch.
 */
export async function draftReceptionSheets(
  files: readonly File[],
  options: {
    onBatchProgress?: (current: number, total: number) => void
    formatBatchWarning?: (warning: string, firstSheet: number, lastSheet: number) => string
    formatRowLimitWarning?: (maxRows: number) => string
    onJobStarted?: (jobId: string) => void
    onJobFinished?: (jobId: string) => void
    signal?: AbortSignal
  } = {},
  resume?: {
    draft: ReceptionDraft
    nextBatchIndex: number
    job?: ReceptionJobResume
  },
): Promise<ReceptionDraft> {
  if (files.reduce((total, file) => total + file.size, 0) > MAX_RECEPTION_SELECTED_BYTES) {
    throw new Error('選択した用紙の合計サイズは1GBまでです。')
  }
  const batches = receptionSheetBatches(files)
  const total = batches.length
  const startBatchIndex = resume?.nextBatchIndex ?? 0
  const visitors: ReceptionDraft['visitors'] = [...(resume?.draft.visitors ?? [])]
  const warnings: string[] = [...(resume?.draft.warnings ?? [])]
  let rowLimitExceeded = resume?.draft.rowLimitExceeded ?? false
  let firstSheet = 1

  for (const [index, batch] of batches.entries()) {
    const lastSheet = firstSheet + batch.length - 1
    if (index < startBatchIndex) {
      firstSheet = lastSheet + 1
      continue
    }
    options.onBatchProgress?.(index + 1, total)
    let jobResume = index === startBatchIndex ? resume?.job : undefined
    try {
      throwIfAborted(options.signal)
      const idempotencyKey = jobResume?.idempotencyKey ?? crypto.randomUUID()
      jobResume = { idempotencyKey, ...(jobResume?.jobId ? { jobId: jobResume.jobId } : {}) }
      const createdJob = await courseboardApiJson<CreatedReceptionOcrJob>(RECEPTION_DRAFT_JOBS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          sheets: batch.map(file => ({ contentType: file.type, size: file.size })),
        }),
        signal: options.signal,
      })
      let job: ReceptionOcrJob = createdJob
      jobResume = { idempotencyKey, jobId: job.id }
      options.onJobStarted?.(job.id)
      throwIfAborted(options.signal)

      if (createdJob.status === 'uploading') {
        if (createdJob.uploads.length !== batch.length) {
          throw new Error('アップロード先の数が受付用紙と一致しません。')
        }
        for (const [sheetIndex, file] of batch.entries()) {
          throwIfAborted(options.signal)
          await putReceptionSheet(createdJob.uploads[sheetIndex]!, file, options.signal)
        }
        throwIfAborted(options.signal)
        job = await courseboardApiJson<ReceptionOcrJob>(
          `${RECEPTION_DRAFT_JOBS_PATH}/${encodeURIComponent(job.id)}/confirm`,
          { method: 'POST', signal: options.signal },
        )
      }

      let advances = 0
      while (job.status !== 'completed' && advances < MAX_RECEPTION_JOB_ADVANCES) {
        throwIfAborted(options.signal)
        if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
          options.onJobFinished?.(job.id)
          jobResume = undefined
          throw new Error('受付用紙の読み取りジョブを続行できません。')
        }
        try {
          job = await courseboardApiJson<ReceptionOcrJob>(
            `${RECEPTION_DRAFT_JOBS_PATH}/${encodeURIComponent(job.id)}/advance`,
            { method: 'POST', signal: options.signal },
          )
          advances += 1
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error
          job = await waitForReceptionJob(job.id, job.completedUnits, options.signal)
        }
      }
      if (job.status !== 'completed') {
        if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
          options.onJobFinished?.(job.id)
          jobResume = undefined
        }
        throw new Error('受付用紙の読み取りに時間がかかっています。もう一度お試しください。')
      }
      options.onJobFinished?.(job.id)
      jobResume = undefined

      const draft = job.draft
      const incomingVisitors = draft.visitors ?? []
      const remainingRows = Math.max(0, MAX_RECEPTION_ROWS - visitors.length)
      visitors.push(...incomingVisitors.slice(0, remainingRows))
      if (incomingVisitors.length > remainingRows) rowLimitExceeded = true
      warnings.push(...(draft.warnings ?? []).map(warning => (
        options.formatBatchWarning?.(warning, firstSheet, lastSheet) ?? warning
      )))
      if (rowLimitExceeded) {
        const rowLimitWarning = options.formatRowLimitWarning?.(MAX_RECEPTION_ROWS)
          ?? 'Only the first ' + MAX_RECEPTION_ROWS + ' reception rows are shown; additional rows were omitted.'
        if (!warnings.includes(rowLimitWarning)) warnings.push(rowLimitWarning)
      }
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (jobResume?.jobId && await isTerminalReceptionJob(jobResume.jobId, options.signal)) {
        options.onJobFinished?.(jobResume.jobId)
        jobResume = undefined
      }
      throw new ReceptionBatchError(
        { visitors, warnings, rowLimitExceeded },
        index,
        error,
        jobResume,
      )
    }
    firstSheet = lastSheet + 1
  }

  return { visitors, warnings, rowLimitExceeded }
}

async function isTerminalReceptionJob(jobId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const job = await courseboardApiJson<ReceptionOcrJob>(
      `${RECEPTION_DRAFT_JOBS_PATH}/${encodeURIComponent(jobId)}`,
      signal ? { signal } : undefined,
    )
    return job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired'
  } catch (error) {
    // A status read does not call the OCR provider. Its client error therefore
    // means the persisted job is terminal; auth, throttling, and server errors
    // remain inconclusive so a runnable job keeps its resume key.
    return error instanceof ApiError
      && error.status >= 400
      && error.status < 500
      && error.status !== 401
      && error.status !== 403
      && error.status !== 429
  }
}

async function waitForReceptionJob(
  jobId: string,
  previousCompletedUnits: number,
  signal?: AbortSignal,
): Promise<ReceptionOcrJob> {
  const path = `${RECEPTION_DRAFT_JOBS_PATH}/${encodeURIComponent(jobId)}`
  let latest: ReceptionOcrJob | undefined
  for (let attempt = 0; attempt < 150; attempt += 1) {
    throwIfAborted(signal)
    const job = await courseboardApiJson<ReceptionOcrJob>(
      path,
      signal ? { signal } : undefined,
    )
    latest = job
    if (job.status !== 'running' || job.completedUnits > previousCompletedUnits) return job
    await abortableDelay(1000, signal)
  }
  if (latest && latest.status !== 'running') return latest
  throw new Error('受付用紙の読み取りに時間がかかっています。もう一度お試しください。')
}

/**
 * Sends the bytes to the Storage capability directly. This fetch deliberately
 * does not use CourseBoard's authenticated API client: a presigned URL is
 * already the authorization, and the user's bearer must never reach Storage.
 */
async function putReceptionSheet(
  upload: { uploadUrl: string },
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  // Development fixtures use a marker URL so the mock flow stays offline.
  if (upload.uploadUrl.startsWith('mock://')) return
  const headers = new Headers()
  if (file.type) headers.set('Content-Type', file.type)
  const response = await fetch(upload.uploadUrl, {
    body: file,
    headers,
    method: 'PUT',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Tachyon Storageへのアップロードに失敗しました（${response.status}）。`)
  }
}

/** Best-effort cancellation used when the reception screen is closed mid-read. */
export async function cancelReceptionOcrJob(jobId: string): Promise<void> {
  await courseboardApiJson<ReceptionOcrJob>(
    `${RECEPTION_DRAFT_JOBS_PATH}/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  )
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => window.setTimeout(resolve, milliseconds))
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Registers one approved row, through the same endpoint the ledger's form uses.
 *
 * `sourceRowIndex` is the line on the sheet, so the entry can be traced back to
 * the paper afterwards.
 */
/**
 * What a registration answers with.
 *
 * `consentsRecorded` is `false` when the person reached the ledger but their
 * consents did not. The registration still succeeded — retrying it would make
 * a second person — so the screen keeps the row saved and says the consents
 * are missing.
 */
export type RegisteredCustomer = Customer & {
  consentsRecorded?: boolean
  customFieldsRecorded?: boolean
}

export function registerReceptionRow(
  row: ReceptionRow,
  sourceRowIndex?: number,
  fields?: readonly ReceptionField[],
  consentItems?: readonly ReceptionConsentItem[],
) {
  return courseboardApiJson<RegisteredCustomer>(customersPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(customerPayload(row, sourceRowIndex, fields, consentItems)),
  })
}

/** Retry only CourseBoard's local custom values after Field already created the customer. */
export function retryReceptionValues(
  customerId: string,
  row: ReceptionRow,
  fields: readonly ReceptionField[],
) {
  const { customFields } = customerPayload(row, undefined, fields)
  return courseboardApiJson<{ recorded: boolean }>(
    `${customersPath}/${encodeURIComponent(customerId)}/reception-values`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customFields }),
    },
  )
}
