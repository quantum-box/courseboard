import { courseboardApiJson } from '../../../../api'
import { customersPath, type Customer } from '../models'
import {
  customerPayload,
  normalizeReceptionFormProposal,
  normalizeReceptionConsentItem,
  normalizeReceptionConsentItems,
  normalizeReceptionFields,
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
export const RECEPTION_FIELDS_PATH = '/v1/course/customer-reception-fields'
export const RECEPTION_FIELDS_ANALYSIS_PATH = `${RECEPTION_FIELDS_PATH}/analysis`
export const RECEPTION_CONSENT_ITEMS_PATH = '/v1/course/customer-consent-items'

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
 * Reads up to fifty sheets in order. Field limits each request by page count
 * and upload size, so send fitting batches sequentially and combine the drafts.
 */
export async function draftReceptionSheets(
  files: readonly File[],
  options: {
    onBatchProgress?: (current: number, total: number) => void
    formatBatchWarning?: (warning: string, firstSheet: number, lastSheet: number) => string
  } = {},
): Promise<ReceptionDraft> {
  const batches = receptionSheetBatches(files)
  const total = batches.length
  const visitors: ReceptionDraft['visitors'] = []
  const warnings: string[] = []
  let firstSheet = 1

  for (const [index, batch] of batches.entries()) {
    const lastSheet = firstSheet + batch.length - 1
    options.onBatchProgress?.(index + 1, total)
    const form = new FormData()
    for (const file of batch) {
      form.append('file', file, uploadFileName(file))
    }
    const draft = await courseboardApiJson<ReceptionDraft>(RECEPTION_DRAFT_PATH, {
      method: 'POST',
      body: form,
    })
    visitors.push(...(draft.visitors ?? []))
    warnings.push(...(draft.warnings ?? []).map(warning => (
      options.formatBatchWarning?.(warning, firstSheet, lastSheet) ?? warning
    )))
    firstSheet = lastSheet + 1
  }

  return { visitors, warnings }
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
