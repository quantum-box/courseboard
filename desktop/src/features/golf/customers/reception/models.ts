/** 受付用紙を読み取って顧客台帳に入れるまでの、画面側の型と判断。 */

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
 * True for a photo taken on an iPhone, however it reached the desk.
 *
 * By type or by extension: a HEIC that arrived over AirDrop, a share sheet, or
 * a file server frequently has an empty `type`, and the extension is then the
 * only thing that says what it is.
 */
export function isHeifFile(file: File) {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return (
    type === 'image/heic'
    || type === 'image/heif'
    || name.endsWith('.heic')
    || name.endsWith('.heif')
  )
}

/**
 * The file as it will be uploaded: HEIC becomes JPEG, everything else is passed
 * through untouched.
 *
 * Converted in the browser rather than upstream, the same way Field's own
 * receipt OCR handles it. The decoder is a large dependency, so it is imported
 * only when a HEIC is actually picked — a desk working from scans never
 * downloads it.
 *
 * The preview uses the converted file too: browsers other than Safari cannot
 * paint a HEIC, and a blank pane beside the rows defeats the whole screen.
 */
export async function prepareReceptionSheet(file: File): Promise<File> {
  if (!isHeifFile(file)) return file
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, quality: 0.92, toType: 'image/jpeg' })
  const jpeg = Array.isArray(converted) ? converted[0] : converted
  if (!jpeg) throw new Error('heic2any returned no image')
  return new File([jpeg], 'document.jpg', {
    lastModified: file.lastModified,
    type: 'image/jpeg',
  })
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

export function customerPayload(row: ReceptionRow) {
  return {
    name: text(row.name),
    nameKana: text(row.nameKana) || null,
    phone: text(row.phone) || null,
    email: text(row.email) || null,
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
