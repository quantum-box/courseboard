/** 受付用紙を読み取って顧客台帳に入れるまでの、画面側の型と判断。 */

import { ApiError } from '../../../../api'
import { heifToJpeg } from './heif'

/**
 * What the desk may pick.
 *
 * Wider than what the reader takes: an iPhone photographs the sheet as HEIC,
 * which is what the desk actually has in hand, and refusing it would mean
 * telling them to convert it themselves. It is converted to JPEG here instead
 * (`prepareReceptionSheet`), so the upload is still one of the three formats
 * the API accepts. Extensions are listed beside the types because a HEIC
 * arriving over AirDrop or a share sheet often carries no MIME type at all.
 */
export const RECEPTION_SHEET_ACCEPT =
  'image/jpeg,image/png,application/pdf,image/heic,image/heif,.heic,.heif'

/** What actually reaches the API, after any conversion. */
export const RECEPTION_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

export const MAX_RECEPTION_SHEET_BYTES = 10 * 1024 * 1024

/**
 * Why nothing was read, when the sheet is not the reason.
 *
 * The API used to answer an upstream outage the same way it answers a blurry
 * photo — 200, no rows, and a warning about the document — because Field did,
 * and a desk whose reader had run out of upstream credit spent a morning
 * re-photographing a sheet nothing was wrong with. Field now says which it is
 * and CourseBoard forwards a code for it, so the screen can stop blaming the
 * paper for something no camera will fix.
 *
 * `warnings` on a 200 still means what it always did: the reader ran, looked at
 * the sheet, and could not make parts of it out. That one *is* worth another
 * photograph.
 */
export type ReceptionReadFailure = 'billing' | 'rateLimited' | 'unavailable'

/**
 * Keyed on the code rather than the status: the status is what survives a
 * proxy, the code is what the API meant, and only the code stays put if a 402
 * ever has to move.
 */
const READ_FAILURE_BY_CODE: Record<string, ReceptionReadFailure> = {
  reception_reader_billing_unsatisfied: 'billing',
  reception_reader_rate_limited: 'rateLimited',
  reception_reader_unavailable: 'unavailable',
}

export function receptionReadFailure(error: unknown): ReceptionReadFailure | null {
  if (!(error instanceof ApiError)) return null
  const details = error.details
  if (typeof details !== 'object' || details === null || !('error' in details)) return null
  const code = (details as { error?: unknown }).error
  return typeof code === 'string' ? READ_FAILURE_BY_CODE[code] ?? null : null
}

/** What came back from the API: a proposal, never a write. */
export type ReceptionDraft = {
  visitors: ReceptionDraftVisitor[]
  warnings: string[]
}

export type ReceptionDraftVisitor = {
  name?: string | null
  nameKana?: string | null
  phone?: string | null
  email?: string | null
}

export type ReceptionFieldKey = 'name' | 'nameKana' | 'phone' | 'email'

export const RECEPTION_FIELD_KEYS: readonly ReceptionFieldKey[] = [
  'name',
  'nameKana',
  'phone',
  'email',
]

/**
 * One person on screen: what the desk has now, and what the sheet was read as.
 *
 * `read` is kept for the life of the row even after the desk edits it — the
 * whole point of the screen is comparing the two, and a value that disappears
 * when corrected cannot be compared to anything.
 */
export type ReceptionRow = {
  key: string
  name: string
  nameKana: string
  phone: string
  email: string
  read: Record<ReceptionFieldKey, string>
  status: 'pending' | 'saving' | 'saved'
  /** Set once registered, so the row can link to the person it became. */
  customerId?: string
  error?: string
}

/**
 * Checked against what will be uploaded, not what was picked.
 *
 * Size too: a HEIC is roughly half the JPEG it becomes, so a photo that passed
 * on the way in can be over the limit by the time it would be sent.
 */
export function fileValidationError(file: File | null): 'required' | 'size' | 'type' | null {
  if (!file) return 'required'
  if (file.size > MAX_RECEPTION_SHEET_BYTES) return 'size'
  if (!RECEPTION_UPLOAD_TYPES.includes(file.type)) return 'type'
  return null
}

/**
 * What the file actually is, read from its first bytes.
 *
 * The name and the MIME type are both unreliable here in ways that decide
 * whether the sheet can be read at all. A phone photo shared through an app
 * often arrives as a JPEG still called `.heic`, and a HEIC arriving over
 * AirDrop or a file server frequently carries no MIME type at all. Sending the
 * first to a HEIC decoder fails on a file that was always readable; refusing
 * the second turns a photo the desk is holding into "choose another file".
 */
export type SheetBytes = 'image/jpeg' | 'image/png' | 'application/pdf' | 'heif' | 'unknown'

export async function sniffSheetBytes(file: File): Promise<SheetBytes> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf'
  // Every HEIC, HEIF and AVIF is an ISO base media file, and they all name the
  // box at offset 4 the same way. The brand that follows says which one it is,
  // and the decoder handles all of them, so the box is enough.
  if (String.fromCharCode(...head.slice(4, 8)) === 'ftyp') return 'heif'
  return 'unknown'
}

function startsWith(bytes: Uint8Array, magic: number[]) {
  return magic.every((byte, index) => bytes[index] === byte)
}

/**
 * The file as it will be uploaded: a phone photo becomes JPEG, everything the
 * reader already takes is passed through.
 *
 * Routed on the bytes rather than on the name, so a JPEG the phone called
 * `.heic` is uploaded as the JPEG it already is instead of being handed to a
 * decoder that refuses it.
 *
 * The preview uses the converted file too: browsers other than Safari cannot
 * paint a HEIC, and a blank pane beside the rows defeats the whole screen.
 */
export async function prepareReceptionSheet(file: File): Promise<File> {
  const bytes = await sniffSheetBytes(file)
  if (bytes === 'heif') return heifToJpeg(file)
  // Nothing recognisable to go on: leave it alone and let the validation below
  // answer on the file's own type, the way it did before anything was sniffed.
  if (bytes === 'unknown' || bytes === file.type) return file
  // Readable bytes under a wrong label. Re-labelling is the whole conversion —
  // the size check and the reader both go by the type, not by the name.
  return new File([file], file.name, { lastModified: file.lastModified, type: bytes })
}

/**
 * Upstream never sees the scanner's filename — it names files after the machine
 * and the minute, and neither is the desk's to send.
 */
export function uploadFileName(file: File) {
  if (file.type === 'application/pdf') return 'document.pdf'
  return file.type === 'image/png' ? 'document.png' : 'document.jpg'
}

function text(value: string | null | undefined) {
  return (value ?? '').trim()
}

export function rowFromVisitor(visitor: ReceptionDraftVisitor, index: number): ReceptionRow {
  const read = {
    name: text(visitor.name),
    nameKana: text(visitor.nameKana),
    phone: text(visitor.phone),
    email: text(visitor.email),
  }
  return {
    // Position, not content: two players in a family share a phone number and
    // sometimes a surname, and a key made of those collapses them into one row.
    key: `visitor-${index}`,
    ...read,
    read,
    status: 'pending',
  }
}

export function rowsFromDraft(draft: ReceptionDraft): ReceptionRow[] {
  return (draft.visitors ?? []).map(rowFromVisitor)
}

/** A row the desk adds because the reader missed somebody on the sheet. */
export function blankRow(key: string): ReceptionRow {
  return {
    key,
    name: '',
    nameKana: '',
    phone: '',
    email: '',
    read: { name: '', nameKana: '', phone: '', email: '' },
    status: 'pending',
  }
}

/**
 * Registerable on a name alone, exactly like the ledger's own form: a group
 * taken by phone often yields nothing else, and demanding more here is what
 * kept visitors out of the ledger to begin with.
 */
export function canRegister(row: ReceptionRow) {
  return row.status === 'pending' && text(row.name).length > 0
}

export function pendingRows(rows: readonly ReceptionRow[]) {
  return rows.filter(canRegister)
}

export function savedCount(rows: readonly ReceptionRow[]) {
  return rows.filter(row => row.status === 'saved').length
}

/**
 * Fields where the desk did not keep what the reader proposed.
 *
 * Shown per field rather than per row: "this one letter was wrong" is the
 * useful signal, and a row-level flag hides which value to re-check.
 */
export function correctedFields(row: ReceptionRow): ReceptionFieldKey[] {
  return RECEPTION_FIELD_KEYS.filter(key => text(row[key]) !== row.read[key])
}

/** True when the reader proposed something for this field and it was changed. */
export function isCorrected(row: ReceptionRow, key: ReceptionFieldKey) {
  return row.read[key].length > 0 && text(row[key]) !== row.read[key]
}

export function customerPayload(row: ReceptionRow, sourceRowIndex?: number) {
  return {
    name: text(row.name),
    nameKana: text(row.nameKana) || null,
    phone: text(row.phone) || null,
    email: text(row.email) || null,
    // Kept so a duplicate found next week can be traced back to the sheet it
    // was read off. The sheet itself is never stored, so this line number is
    // the only pointer at the paper the desk still has.
    source: 'reception_sheet' as const,
    sourceRowIndex,
  }
}

/**
 * Rows the sheet named more than once.
 *
 * Not deduplicated automatically: a foursome can genuinely contain two people
 * with the same name, and dropping the second silently loses a player. The
 * screen says so and lets the desk decide.
 */
export function duplicateNameKeys(rows: readonly ReceptionRow[]): Set<string> {
  const seen = new Map<string, string[]>()
  for (const row of rows) {
    const name = text(row.name)
    if (!name) continue
    seen.set(name, [...(seen.get(name) ?? []), row.key])
  }
  const duplicates = new Set<string>()
  for (const keys of seen.values()) {
    if (keys.length > 1) keys.forEach(key => duplicates.add(key))
  }
  return duplicates
}

/** Object URLs are revoked by the caller; this only decides how to show it. */
export function previewKind(file: File): 'image' | 'pdf' {
  return file.type === 'application/pdf' ? 'pdf' : 'image'
}
