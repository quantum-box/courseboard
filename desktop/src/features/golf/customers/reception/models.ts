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

export type ReceptionAddress = {
  postalCode?: string | null
  state?: string | null
  city?: string | null
  address1?: string | null
  address2?: string | null
}

export type ReceptionFieldValue = string | number | boolean | ReceptionAddress | null

export type ReceptionDraftVisitor = {
  name?: string | null
  nameKana?: string | null
  /** The API may use the database spelling for fields in a draft. */
  name_kana?: string | null
  phone?: string | null
  email?: string | null
  birthDate?: string | null
  birth_date?: string | null
  sex?: string | null
  address?: ReceptionAddress | string | null
  customFields?: Record<string, ReceptionFieldValue>
  custom_fields?: Record<string, ReceptionFieldValue>
  consents?: ReceptionDraftConsent[]
}

export type ReceptionDraftConsent = {
  key: string
  /** Absent when the reader could not resolve the box. Not a refusal. */
  accepted?: boolean | null
}

/**
 * The tick boxes a golf reception sheet carries, in printed order.
 *
 * The keys are the API's, and the same ones Field files the record under. The
 * screen never inverts anything: the API already flipped the printed opt-out,
 * so `accepted: true` here means the visitor agreed however the paper phrased
 * it. What the screen does carry is the printed wording, because the desk is
 * comparing the row against the page.
 */
export const RECEPTION_CONSENT_KEYS = [
  'golf_antisocial_and_course_terms',
  'golf_cart_terms',
  'golf_marketing_contact',
] as const

export type ReceptionConsentKey = (typeof RECEPTION_CONSENT_KEYS)[number]

/**
 * The one box the sheet itself marks 「必ず☑をご記入下さい」.
 *
 * The API refuses a registration without it, so the screen has to stop the row
 * before it is sent — otherwise the desk gets a 400 they cannot act on for a
 * box they can see ticked on the paper in front of them.
 */
export const REQUIRED_RECEPTION_CONSENT: ReceptionConsentKey =
  'golf_antisocial_and_course_terms'

/** Unanswered is `null`, which is neither agreement nor refusal. */
export type ConsentAnswer = boolean | null

export type ReceptionConsents = Record<ReceptionConsentKey, ConsentAnswer>

function emptyConsents(): ReceptionConsents {
  return {
    golf_antisocial_and_course_terms: null,
    golf_cart_terms: null,
    golf_marketing_contact: null,
  }
}

function consentsFromVisitor(visitor: ReceptionDraftVisitor): ReceptionConsents {
  const consents = emptyConsents()
  for (const answer of visitor.consents ?? []) {
    if ((RECEPTION_CONSENT_KEYS as readonly string[]).includes(answer.key)) {
      consents[answer.key as ReceptionConsentKey] = answer.accepted ?? null
    }
  }
  return consents
}

/** The stable keys used by the CourseBoard reception-field API. */
export const RECEPTION_STANDARD_FIELD_KEYS = [
  'name',
  'name_kana',
  'phone',
  'email',
  'birth_date',
  'sex',
  'address',
] as const

export type ReceptionStandardFieldKey = (typeof RECEPTION_STANDARD_FIELD_KEYS)[number]

/**
 * Kept for callers of the original four-field helpers. New settings use the
 * snake-case `ReceptionStandardFieldKey` values above; these keys describe the
 * four React properties that existed before arbitrary fields were introduced.
 */
export type ReceptionFieldKey = 'name' | 'nameKana' | 'phone' | 'email'

export const RECEPTION_FIELD_KEYS: readonly ReceptionFieldKey[] = [
  'name',
  'nameKana',
  'phone',
  'email',
]

export type ReceptionFieldKind = 'standard' | 'custom'
export type ReceptionFieldType =
  | 'text'
  | 'tel'
  | 'email'
  | 'date'
  | 'select'
  | 'boolean'
  | 'address'

export type ReceptionField = {
  fieldKey: string
  kind: ReceptionFieldKind
  fieldType: ReceptionFieldType
  enabled: boolean
  required: boolean
  /** Effective label returned by the API; `customLabel` says if it is stored. */
  label: string
  /** The API returns the effective label, so retain whether it was custom. */
  customLabel: boolean
  sortOrder: number
  options: string[]
}

export type ReceptionFieldWriteInput = {
  fieldKey: string
  kind: ReceptionFieldKind
  fieldType: ReceptionFieldType
  enabled: boolean
  required: boolean
  label: string | null
  /** True only when `label` is an explicit tenant override. */
  customLabel: boolean
  sortOrder: number
  options: string[]
}

const STANDARD_FIELD_DEFAULTS: readonly ReceptionField[] = [
  {
    fieldKey: 'name',
    kind: 'standard',
    fieldType: 'text',
    enabled: true,
    required: true,
    label: '氏名',
    customLabel: false,
    sortOrder: 0,
    options: [],
  },
  {
    fieldKey: 'name_kana',
    kind: 'standard',
    fieldType: 'text',
    enabled: true,
    required: false,
    label: '氏名のふりがな（カタカナ）',
    customLabel: false,
    sortOrder: 1,
    options: [],
  },
  {
    fieldKey: 'phone',
    kind: 'standard',
    fieldType: 'tel',
    enabled: true,
    required: false,
    label: '電話番号',
    customLabel: false,
    sortOrder: 2,
    options: [],
  },
  {
    fieldKey: 'email',
    kind: 'standard',
    fieldType: 'email',
    enabled: true,
    required: false,
    label: 'メールアドレス',
    customLabel: false,
    sortOrder: 3,
    options: [],
  },
  {
    fieldKey: 'birth_date',
    kind: 'standard',
    fieldType: 'date',
    enabled: false,
    required: false,
    label: '生年月日',
    customLabel: false,
    sortOrder: 4,
    options: [],
  },
  {
    fieldKey: 'sex',
    kind: 'standard',
    fieldType: 'text',
    enabled: false,
    required: false,
    label: '性別',
    customLabel: false,
    sortOrder: 5,
    options: [],
  },
  {
    fieldKey: 'address',
    kind: 'standard',
    fieldType: 'address',
    enabled: false,
    required: false,
    label: '住所',
    customLabel: false,
    sortOrder: 6,
    options: [],
  },
]

export const DEFAULT_RECEPTION_FIELDS: readonly ReceptionField[] = STANDARD_FIELD_DEFAULTS

const STANDARD_KEY_ALIASES: Record<string, ReceptionStandardFieldKey> = {
  name: 'name',
  nameKana: 'name_kana',
  name_kana: 'name_kana',
  phone: 'phone',
  email: 'email',
  birthDate: 'birth_date',
  birth_date: 'birth_date',
  sex: 'sex',
  address: 'address',
}

const STANDARD_DEFAULT_BY_KEY = new Map(
  STANDARD_FIELD_DEFAULTS.map(field => [field.fieldKey, field]),
)

const STANDARD_DEFAULT_LABELS: Record<ReceptionStandardFieldKey, string> = {
  name: '氏名',
  name_kana: '氏名のふりがな（カタカナ）',
  phone: '電話番号',
  email: 'メールアドレス',
  birth_date: '生年月日',
  sex: '性別',
  address: '住所',
}

export function canonicalReceptionFieldKey(key: string): string {
  return STANDARD_KEY_ALIASES[key] ?? key
}

export function isStandardReceptionFieldKey(key: string): key is ReceptionStandardFieldKey {
  return Object.prototype.hasOwnProperty.call(STANDARD_KEY_ALIASES, key)
}

function fieldType(value: unknown, fallback: ReceptionFieldType): ReceptionFieldType {
  return value === 'text'
    || value === 'tel'
    || value === 'email'
    || value === 'date'
    || value === 'select'
    || value === 'boolean'
    || value === 'address'
    ? value
    : fallback
}

function optionsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(option => {
        if (typeof option === 'string') return option.trim()
        if (typeof option === 'object' && option !== null) {
          const item = option as { label?: unknown; value?: unknown }
          return String(item.label ?? item.value ?? '').trim()
        }
        return ''
      })
      .filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return optionsFromUnknown(JSON.parse(value))
    } catch {
      return value.split(/[,\n]/u).map(option => option.trim()).filter(Boolean)
    }
  }
  return []
}

/** Accepts both camelCase DTOs and the snake-case values used in SQL/domain tests. */
export function normalizeReceptionField(value: unknown, index = 0): ReceptionField | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const rawKey = raw.fieldKey ?? raw.field_key ?? raw.key
  if (typeof rawKey !== 'string' || !rawKey.trim()) return null
  const fieldKey = canonicalReceptionFieldKey(rawKey.trim())
  const standard = STANDARD_DEFAULT_BY_KEY.get(fieldKey)
  const rawType = raw.fieldType ?? raw.field_type ?? raw.type
  const kind: ReceptionFieldKind = standard ? 'standard' : 'custom'
  const defaultLabel = isStandardReceptionFieldKey(fieldKey)
    ? STANDARD_DEFAULT_LABELS[fieldKey]
    : fieldKey
  const effectiveLabel = typeof raw.label === 'string' && raw.label.trim()
    ? raw.label.trim()
    : defaultLabel
  // New servers tell us explicitly. Older responses only returned the
  // effective label, so infer an override when it differs from the default.
  const rawCustomLabel = raw.customLabel ?? raw.custom_label
  const customLabel = rawCustomLabel === true
    || (rawCustomLabel === undefined && effectiveLabel !== defaultLabel)
  return {
    fieldKey,
    kind,
    fieldType: fieldType(rawType, standard?.fieldType ?? 'text'),
    enabled: raw.enabled !== false,
    required: raw.required === true || (standard?.required ?? false),
    label: effectiveLabel,
    customLabel,
    sortOrder: typeof raw.sortOrder === 'number'
      ? raw.sortOrder
      : typeof raw.sort_order === 'number'
        ? raw.sort_order
        : standard?.sortOrder ?? index,
    options: optionsFromUnknown(raw.options ?? raw.optionsJson ?? raw.options_json),
  }
}

/** GET returns a complete standard list, but merge defensively for old servers. */
export function normalizeReceptionFields(value: unknown): ReceptionField[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? ((value as { items?: unknown; fields?: unknown }).items
        ?? (value as { fields?: unknown }).fields)
      : undefined
  const parsed = Array.isArray(rawItems)
    ? rawItems.map((item, index) => normalizeReceptionField(item, index)).filter(
      (item): item is ReceptionField => item !== null,
    )
    : []
  const byKey = new Map(parsed.map(field => [field.fieldKey, field]))
  const standards = STANDARD_FIELD_DEFAULTS.map(field => byKey.get(field.fieldKey) ?? { ...field })
  const customs = parsed.filter(field => field.kind === 'custom' && !STANDARD_DEFAULT_BY_KEY.has(field.fieldKey))
  return [...standards, ...customs].sort((left, right) =>
    left.sortOrder - right.sortOrder || left.fieldKey.localeCompare(right.fieldKey),
  )
}

export function receptionFieldDefaultLabel(fieldKey: string): string {
  const canonical = canonicalReceptionFieldKey(fieldKey.trim())
  return isStandardReceptionFieldKey(canonical)
    ? STANDARD_DEFAULT_LABELS[canonical]
    : canonical
}

export function receptionFieldLabel(field: ReceptionField): string {
  return field.label.trim() || receptionFieldDefaultLabel(field.fieldKey)
}

export type ReceptionFieldValues = Record<string, ReceptionFieldValue>

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
  /** Current values keyed by the standard or custom field key. */
  values: ReceptionFieldValues
  /** Values as returned by OCR, kept for corrected-value display. */
  readValues: ReceptionFieldValues
  /** The custom subset is kept explicitly for the registration contract. */
  customFields: ReceptionFieldValues
  readCustomFields: ReceptionFieldValues
  /** The four legacy React properties, retained for correction helpers. */
  read: Record<ReceptionFieldKey, string>
  /** What the desk has now, after any correction. */
  consents: ReceptionConsents
  /** What the reader made of the boxes, kept for comparison like `read`. */
  readConsents: ReceptionConsents
  status: 'pending' | 'saving' | 'saved'
  /** Set once registered, so the row can link to the person it became. */
  customerId?: string
  /**
   * True when the customer was created but their consents were not filed.
   *
   * The registration still counts — the person is in the ledger — so the row
   * is saved. The gap is shown separately, because the fix is to retry the
   * consents, not the registration: registering again makes a second person.
   */
  consentsMissing?: boolean
  /** True when the customer was created but custom answers were not stored. */
  customFieldsMissing?: boolean
  customFieldsRetrying?: boolean
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

export function valueText(value: ReceptionFieldValue): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object' && value !== null) {
    return [
      value.postalCode,
      value.state,
      value.city,
      value.address1,
      value.address2,
    ].filter(Boolean).join(' ')
  }
  return ''
}

function addressFromUnknown(value: unknown): ReceptionAddress | string | null {
  if (typeof value === 'string') return text(value) || null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const part = (camel: string, snake: string) => {
    const candidate = raw[camel] ?? raw[snake]
    return typeof candidate === 'string' ? candidate.trim() : ''
  }
  const address: ReceptionAddress = {
    postalCode: part('postalCode', 'postal_code'),
    state: part('state', 'prefecture'),
    city: part('city', 'municipality'),
    address1: part('address1', 'address_1'),
    address2: part('address2', 'address_2'),
  }
  return Object.values(address).some(Boolean) ? address : null
}

function receptionValue(value: unknown, address = false): ReceptionFieldValue {
  if (address) return addressFromUnknown(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return text(value) || null
  if (typeof value === 'number') return String(value)
  return null
}

function visitorStandardValue(visitor: ReceptionDraftVisitor, fieldKey: string): ReceptionFieldValue {
  switch (fieldKey) {
    case 'name': return receptionValue(visitor.name)
    case 'name_kana': return receptionValue(visitor.nameKana ?? visitor.name_kana)
    case 'phone': return receptionValue(visitor.phone)
    case 'email': return receptionValue(visitor.email)
    case 'birth_date': return receptionValue(visitor.birthDate ?? visitor.birth_date)
    case 'sex': return receptionValue(visitor.sex)
    case 'address': return receptionValue(visitor.address, true)
    default: return null
  }
}

function cloneReceptionValue(value: ReceptionFieldValue): ReceptionFieldValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value }
    : value
}

function customValuesFromVisitor(visitor: ReceptionDraftVisitor): ReceptionFieldValues {
  const source = visitor.customFields ?? visitor.custom_fields ?? {}
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !isStandardReceptionFieldKey(canonicalReceptionFieldKey(key)))
      .map(([key, value]) => [key, receptionValue(value)]),
  )
}

function legacyFieldValue(values: ReceptionFieldValues, key: ReceptionFieldKey): string {
  const value = values[key === 'nameKana' ? 'name_kana' : key]
  return valueText(value)
}

function valuesForFields(
  values: ReceptionFieldValues,
  fields: readonly ReceptionField[],
): ReceptionFieldValues {
  const next = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, cloneReceptionValue(value)]),
  )
  for (const field of fields) {
    if (!(field.fieldKey in next)) next[field.fieldKey] = null
  }
  return next
}

export function rowFromVisitor(
  visitor: ReceptionDraftVisitor,
  index: number,
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
): ReceptionRow {
  const customFields = customValuesFromVisitor(visitor)
  const configuredCustomFields = Object.fromEntries([
    ...Object.entries(customFields),
    ...fields
      .filter(field => field.kind === 'custom' && !(field.fieldKey in customFields))
      .map(field => [field.fieldKey, null]),
  ])
  const values = valuesForFields({
    name: visitorStandardValue(visitor, 'name'),
    name_kana: visitorStandardValue(visitor, 'name_kana'),
    phone: visitorStandardValue(visitor, 'phone'),
    email: visitorStandardValue(visitor, 'email'),
    birth_date: visitorStandardValue(visitor, 'birth_date'),
    sex: visitorStandardValue(visitor, 'sex'),
    address: visitorStandardValue(visitor, 'address'),
    ...configuredCustomFields,
  }, fields)
  const readValues = valuesForFields(values, fields)
  const read = {
    name: legacyFieldValue(readValues, 'name'),
    nameKana: legacyFieldValue(readValues, 'nameKana'),
    phone: legacyFieldValue(readValues, 'phone'),
    email: legacyFieldValue(readValues, 'email'),
  }
  const consents = consentsFromVisitor(visitor)
  return {
    // Position, not content: two players in a family share a phone number and
    // sometimes a surname, and a key made of those collapses them into one row.
    key: `visitor-${index}`,
    name: read.name,
    nameKana: read.nameKana,
    phone: read.phone,
    email: read.email,
    values,
    readValues,
    customFields: Object.fromEntries(
      Object.entries(configuredCustomFields)
        .map(([key, value]) => [key, cloneReceptionValue(value as ReceptionFieldValue)]),
    ),
    readCustomFields: Object.fromEntries(
      Object.entries(configuredCustomFields)
        .map(([key, value]) => [key, cloneReceptionValue(value as ReceptionFieldValue)]),
    ),
    read,
    consents,
    readConsents: { ...consents },
    status: 'pending',
  }
}

export function rowsFromDraft(
  draft: ReceptionDraft,
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
): ReceptionRow[] {
  return (draft.visitors ?? []).map((visitor, index) => rowFromVisitor(visitor, index, fields))
}

/** A row the desk adds because the reader missed somebody on the sheet. */
export function blankRow(
  key: string,
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
): ReceptionRow {
  const values = Object.fromEntries(fields.map(field => [field.fieldKey, null]))
  const customFields = Object.fromEntries(
    fields
      .filter(field => field.kind === 'custom')
      .map(field => [field.fieldKey, null]),
  )
  return {
    key,
    name: '',
    nameKana: '',
    phone: '',
    email: '',
    values,
    readValues: { ...values },
    customFields,
    readCustomFields: { ...customFields },
    read: { name: '', nameKana: '', phone: '', email: '' },
    consents: emptyConsents(),
    readConsents: emptyConsents(),
    status: 'pending',
  }
}

function legacyValueForKey(row: ReceptionRow, fieldKey: string): string | null {
  switch (fieldKey) {
    case 'name': return row.name
    case 'name_kana': return row.nameKana
    case 'phone': return row.phone
    case 'email': return row.email
    default: return null
  }
}

/** Read a field while accepting the four legacy row properties used by old callers. */
export function receptionRowValue(row: ReceptionRow, fieldKey: string): ReceptionFieldValue {
  const canonical = canonicalReceptionFieldKey(fieldKey)
  const dynamic = row.values?.[canonical] ?? row.customFields?.[canonical]
  const legacy = legacyValueForKey(row, canonical)
  // Existing callers can spread any row and replace one of the original four
  // properties directly. Those properties remain the compatibility surface;
  // new edits update both them and the dynamic map together.
  if (legacy !== null) return receptionValue(legacy)
  if (dynamic !== undefined) return dynamic
  return null
}

export function receptionRowReadValue(row: ReceptionRow, fieldKey: string): ReceptionFieldValue {
  const canonical = canonicalReceptionFieldKey(fieldKey)
  const dynamic = row.readValues?.[canonical] ?? row.readCustomFields?.[canonical]
  if (dynamic !== undefined) return dynamic
  const legacyKey = canonical === 'name_kana' ? 'nameKana' : canonical as ReceptionFieldKey
  return row.read?.[legacyKey] ? row.read[legacyKey] : null
}

/** Build the React row patch that keeps legacy and dynamic values in sync. */
export function updateReceptionRowField(
  row: ReceptionRow,
  fieldKey: string,
  value: ReceptionFieldValue,
): Partial<ReceptionRow> {
  const canonical = canonicalReceptionFieldKey(fieldKey)
  const values = { ...(row.values ?? {}), [canonical]: cloneReceptionValue(value) }
  const patch: Partial<ReceptionRow> = { values }
  const legacy = valueText(value)
  switch (canonical) {
    case 'name': patch.name = legacy; break
    case 'name_kana': patch.nameKana = legacy; break
    case 'phone': patch.phone = legacy; break
    case 'email': patch.email = legacy; break
    case 'birth_date':
    case 'sex':
    case 'address':
      // These are standard fields too; only the remaining keys belong in the
      // CourseBoard-owned custom-field map.
      break
    default:
      patch.customFields = { ...(row.customFields ?? {}), [canonical]: cloneReceptionValue(value) }
      break
  }
  return patch
}

export function fieldValueIsEmpty(value: ReceptionFieldValue): boolean {
  if (typeof value === 'boolean') return false
  return valueText(value).length === 0
}

export function fieldValuesEqual(left: ReceptionFieldValue, right: ReceptionFieldValue): boolean {
  if (left === right) return true
  if (typeof left !== typeof right) return false
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    return valueText(left) === valueText(right)
      && left.postalCode === right.postalCode
      && left.state === right.state
      && left.city === right.city
      && left.address1 === right.address1
      && left.address2 === right.address2
  }
  return left === right
}

/**
 * Registerable on a name alone, exactly like the ledger's own form: a group
 * taken by phone often yields nothing else, and demanding more here is what
 * kept visitors out of the ledger to begin with.
 */
export function missingRequiredFields(
  row: ReceptionRow,
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
): ReceptionField[] {
  return fields.filter(field =>
    field.enabled
      && field.required
      && fieldValueIsEmpty(receptionRowValue(row, field.fieldKey)),
  )
}

export function canRegister(
  row: ReceptionRow,
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
) {
  return (
    row.status === 'pending' &&
    valueText(receptionRowValue(row, 'name')).length > 0 &&
    row.consents[REQUIRED_RECEPTION_CONSENT] === true &&
    missingRequiredFields(row, fields).length === 0
  )
}

/**
 * Why a named row still cannot be registered.
 *
 * Separate from `canRegister` so the screen can say which of the two things is
 * missing. A button that is simply disabled next to a filled-in name reads as
 * a bug, and the desk retypes the name looking for the problem.
 */
export type ReceptionBlockedReason =
  | 'name'
  | 'declaration'
  | { kind: 'field'; fieldKey: string; label: string }
  | null

export function blockedReason(
  row: ReceptionRow,
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
): ReceptionBlockedReason {
  if (row.status !== 'pending') return null
  if (valueText(receptionRowValue(row, 'name')).length === 0) return 'name'
  if (row.consents[REQUIRED_RECEPTION_CONSENT] !== true) return 'declaration'
  const missing = missingRequiredFields(row, fields).find(field => field.fieldKey !== 'name')
  if (missing) return { kind: 'field', fieldKey: missing.fieldKey, label: receptionFieldLabel(missing) }
  return null
}

/** Boxes where the desk did not keep what the reader proposed. */
export function correctedConsents(row: ReceptionRow): ReceptionConsentKey[] {
  return RECEPTION_CONSENT_KEYS.filter(key => row.consents[key] !== row.readConsents[key])
}

export function isConsentCorrected(row: ReceptionRow, key: ReceptionConsentKey) {
  return row.consents[key] !== row.readConsents[key]
}

export function pendingRows(
  rows: readonly ReceptionRow[],
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
) {
  return rows.filter(row => canRegister(row, fields))
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

export function isReceptionFieldCorrected(row: ReceptionRow, field: ReceptionField) {
  const read = receptionRowReadValue(row, field.fieldKey)
  return !fieldValueIsEmpty(read)
    && !fieldValuesEqual(receptionRowValue(row, field.fieldKey), read)
}

export function correctedReceptionFields(
  row: ReceptionRow,
  fields: readonly ReceptionField[],
): ReceptionField[] {
  return fields.filter(field => isReceptionFieldCorrected(row, field))
}

function payloadValue(value: ReceptionFieldValue): ReceptionFieldValue {
  if (typeof value === 'string') return text(value) || null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'object' && value !== null) {
    return fieldValueIsEmpty(value) ? null : { ...value }
  }
  return null
}

export function customerPayload(
  row: ReceptionRow,
  sourceRowIndex?: number,
  fields: readonly ReceptionField[] = DEFAULT_RECEPTION_FIELDS,
) {
  const customKeys = new Set([
    ...fields.filter(field => field.kind === 'custom').map(field => field.fieldKey),
    ...Object.keys(row.customFields ?? {})
      .filter(key => !isStandardReceptionFieldKey(canonicalReceptionFieldKey(key))),
  ])
  const customFields = Object.fromEntries(
    [...customKeys].map(fieldKey => [fieldKey, payloadValue(receptionRowValue(row, fieldKey))]),
  )
  return {
    name: valueText(receptionRowValue(row, 'name')),
    nameKana: payloadValue(receptionRowValue(row, 'name_kana')),
    phone: payloadValue(receptionRowValue(row, 'phone')),
    email: payloadValue(receptionRowValue(row, 'email')),
    birthDate: payloadValue(receptionRowValue(row, 'birth_date')),
    sex: payloadValue(receptionRowValue(row, 'sex')),
    address: payloadValue(receptionRowValue(row, 'address')),
    customFields,
    // Kept so a duplicate found next week can be traced back to the sheet it
    // was read off. The sheet itself is never stored, so this line number is
    // the only pointer at the paper the desk still has.
    source: 'reception_sheet' as const,
    sourceRowIndex,
    // Every box, including the ones nobody could resolve. An unanswered box is
    // sent as `null` rather than dropped so the API can tell "not ticked" from
    // "not on this sheet"; it files neither.
    consents: RECEPTION_CONSENT_KEYS.map(key => ({
      key,
      accepted: row.consents[key],
    })),
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
    const name = valueText(receptionRowValue(row, 'name'))
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
