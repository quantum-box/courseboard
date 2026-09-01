import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../../api'
import {
  applyReceptionFormProposal,
  blankRow,
  blockedReason,
  canonicalReceptionFieldKey,
  canRegister,
  correctedFields,
  customerPayload,
  DEFAULT_RECEPTION_FIELDS,
  duplicateNameKeys,
  fileValidationError,
  isCorrected,
  isReceptionFieldCorrected,
  missingRequiredFields,
  normalizeReceptionField,
  normalizeReceptionFields,
  normalizeReceptionFormProposal,
  pendingRows,
  receptionFieldDefaultLabel,
  prepareReceptionSheet,
  previewKind,
  receptionPreviewImageSrc,
  receptionReadFailure,
  receptionRowValue,
  rowsFromDraft,
  savedCount,
  sniffSheetBytes,
  updateReceptionRowField,
  uploadFileName,
  MAX_RECEPTION_SHEET_BYTES,
  RECEPTION_SHEET_ACCEPT,
  REQUIRED_RECEPTION_CONSENT,
  type ReceptionField,
  type ReceptionRow,
} from './models'

/** A row the desk has confirmed the declaration on, which is what registering needs. */
function declared(row: ReceptionRow): ReceptionRow {
  return { ...row, consents: { ...row.consents, [REQUIRED_RECEPTION_CONSENT]: true } }
}

const heifToJpeg = vi.hoisted(() => vi.fn())
vi.mock('./heif', () => ({ heifToJpeg }))

function file(type: string, size = 1024) {
  return { name: 'scan-2026-08-16-093000.jpg', size, type } as File
}

/** A file whose first bytes are what a real one of its kind would start with. */
function bytes(magic: number[], name: string, type = '') {
  return new File([new Uint8Array([...magic, ...new Array(16).fill(0)])], name, { type })
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PDF = [0x25, 0x50, 0x44, 0x46]
// `....ftypheic`: what every photo out of an iPhone camera starts with.
const HEIC = [0x00, 0x00, 0x00, 0x24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]

describe('fileValidationError', () => {
  it('accepts the three formats the reader can read', () => {
    expect(fileValidationError(file('image/jpeg'))).toBeNull()
    expect(fileValidationError(file('image/png'))).toBeNull()
    expect(fileValidationError(file('application/pdf'))).toBeNull()
  })

  it('refuses a spreadsheet before it crosses the network', () => {
    expect(fileValidationError(file('application/vnd.ms-excel'))).toBe('type')
  })

  it('refuses a scan larger than the reader will take', () => {
    expect(fileValidationError(file('image/jpeg', MAX_RECEPTION_SHEET_BYTES + 1))).toBe('size')
  })

  it('reports nothing chosen separately from something wrong', () => {
    expect(fileValidationError(null)).toBe('required')
  })
})

describe('HEIC from a phone', () => {
  beforeEach(() => {
    heifToJpeg.mockReset()
  })

  it('is offered in the picker alongside the formats the API takes', () => {
    expect(RECEPTION_SHEET_ACCEPT).toContain('image/heic')
    expect(RECEPTION_SHEET_ACCEPT).toContain('.heif')
  })

  it('is recognised by its bytes, whatever the phone called it', async () => {
    expect(await sniffSheetBytes(bytes(HEIC, 'IMG_0421.HEIC', 'image/heic'))).toBe('heif')
    expect(await sniffSheetBytes(bytes(HEIC, 'sheet.bin'))).toBe('heif')
    expect(await sniffSheetBytes(bytes(JPEG, 'sheet.jpg', 'image/jpeg'))).toBe('image/jpeg')
    expect(await sniffSheetBytes(bytes(PNG, 'sheet.png', 'image/png'))).toBe('image/png')
    expect(await sniffSheetBytes(bytes(PDF, 'sheet.pdf', 'application/pdf'))).toBe(
      'application/pdf',
    )
    expect(await sniffSheetBytes(bytes([0x50, 0x4b, 0x03, 0x04], 'book.xlsx'))).toBe('unknown')
  })

  it('is converted to a JPEG upload', async () => {
    const jpeg = new File(['jpeg'], 'document.jpg', { type: 'image/jpeg' })
    heifToJpeg.mockResolvedValueOnce(jpeg)
    const converted = await prepareReceptionSheet(bytes(HEIC, 'IMG_0421.HEIC', 'image/heic'))
    expect(heifToJpeg).toHaveBeenCalledOnce()
    expect(converted).toBe(jpeg)
    expect(fileValidationError(converted)).toBeNull()
  })

  it('uploads a JPEG the phone named .heic instead of failing to convert it', async () => {
    // Sharing a photo through an app hands over a JPEG under the name it had
    // on the phone. Sent to a HEIC decoder it is refused, and the desk is told
    // to export a file that was already exported.
    const shared = bytes(JPEG, 'IMG_0421.HEIC', 'image/heic')
    const prepared = await prepareReceptionSheet(shared)
    expect(heifToJpeg).not.toHaveBeenCalled()
    expect(prepared.type).toBe('image/jpeg')
    expect(fileValidationError(prepared)).toBeNull()
  })

  it('leaves a scan the reader already accepts untouched', async () => {
    const scan = bytes(PNG, 'sheet.png', 'image/png')
    expect(await prepareReceptionSheet(scan)).toBe(scan)
    expect(heifToJpeg).not.toHaveBeenCalled()
  })

  it('rejects a HEIC that was never converted, rather than uploading it', () => {
    expect(fileValidationError(file('image/heic'))).toBe('type')
  })
})

describe('uploadFileName', () => {
  it("replaces the scanner's own filename", () => {
    expect(uploadFileName(file('image/jpeg'))).toBe('document.jpg')
    expect(uploadFileName(file('image/png'))).toBe('document.png')
    expect(uploadFileName(file('application/pdf'))).toBe('document.pdf')
  })
})

describe('rowsFromDraft', () => {
  it('keeps what the reader proposed beside what the desk now has', () => {
    const rows = rowsFromDraft({
      visitors: [{ name: ' 本田 康彦 ', nameKana: 'ホンダ ヤスヒコ', phone: null, email: null }],
      warnings: [],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('本田 康彦')
    expect(rows[0].read.name).toBe('本田 康彦')
    expect(rows[0].phone).toBe('')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].values.name).toBe('本田 康彦')
    expect(rows[0].values.birth_date).toBeNull()
  })

  it('carries configured standard and custom values for dynamic row rendering', () => {
    const fields = [
      ...DEFAULT_RECEPTION_FIELDS.map(field => field.fieldKey === 'birth_date'
        ? { ...field, enabled: true, required: true }
        : field),
      {
        fieldKey: 'membership_class',
        kind: 'custom' as const,
        fieldType: 'select' as const,
        enabled: true,
        required: true,
        label: '会員区分',
        customLabel: true,
        sortOrder: 7,
        options: ['正会員', 'ゲスト'],
      },
    ]
    const rows = rowsFromDraft({
      visitors: [{
        name: '本田 康彦',
        birthDate: '1978-04-03',
        address: {
          postalCode: '100-0001',
          state: '東京都',
          city: '千代田区',
          address1: '千代田1-1-1',
          address2: 'サンプルビル',
        },
        customFields: { membership_class: '正会員' },
      }],
      warnings: [],
    }, fields)
    expect(rows[0].values.birth_date).toBe('1978-04-03')
    expect(rows[0].values.address).toEqual({
      postalCode: '100-0001',
      state: '東京都',
      city: '千代田区',
      address1: '千代田1-1-1',
      address2: 'サンプルビル',
    })
    expect(rows[0].customFields).toEqual({ membership_class: '正会員' })
    expect(rows[0].readCustomFields).toEqual({ membership_class: '正会員' })
  })

  it('never treats standard keys from a draft customFields object as local custom values', () => {
    const [row] = rowsFromDraft({
      visitors: [{
        name: '本田 康彦',
        customFields: { name: '偽名', name_kana: 'ニセメイ', membership_class: '正会員' },
      }],
      warnings: [],
    })
    expect(row.customFields).toEqual({ membership_class: '正会員' })
    expect(customerPayload(row).customFields).toEqual({ membership_class: '正会員' })
  })

  it('gives two players with the same name distinct rows', () => {
    const rows = rowsFromDraft({
      visitors: [{ name: '本田 康彦' }, { name: '本田 康彦' }],
      warnings: [],
    })
    expect(new Set(rows.map(row => row.key)).size).toBe(2)
  })

  it('survives a sheet the reader could make nothing of', () => {
    expect(rowsFromDraft({ visitors: [], warnings: ['読み取れませんでした。'] })).toEqual([])
  })
})

describe('canRegister', () => {
  it('registers on a name and the declaration, with nothing else asked for', () => {
    expect(canRegister(declared({ ...blankRow('a'), name: '本田 康彦' }))).toBe(true)
  })

  it('refuses a row with nothing but whitespace in the name', () => {
    expect(canRegister(declared({ ...blankRow('a'), name: '   ' }))).toBe(false)
  })

  it('does not register the same row twice', () => {
    const saved = declared({ ...blankRow('a'), name: '本田 康彦', status: 'saved' })
    expect(canRegister(saved)).toBe(false)
  })

  // The API refuses it too. Stopping here means the desk sees which box to
  // look at instead of a 400 about a sheet they can see is ticked.
  it('refuses a row whose declaration is not ticked', () => {
    expect(canRegister({ ...blankRow('a'), name: '本田 康彦' })).toBe(false)
  })

  // Unreadable and refused are different states that both leave the box empty,
  // and neither of them is agreement.
  it('refuses a row whose declaration was read as not ticked', () => {
    const refused: ReceptionRow = {
      ...blankRow('a'),
      name: '本田 康彦',
      consents: { ...blankRow('a').consents, [REQUIRED_RECEPTION_CONSENT]: false },
    }
    expect(canRegister(refused)).toBe(false)
  })

  it('does not require the boxes the sheet leaves optional', () => {
    const row = declared({ ...blankRow('a'), name: '本田 康彦' })
    expect(canRegister({ ...row, consents: { ...row.consents, golf_cart_terms: null } })).toBe(true)
  })

  it('requires enabled configured fields and accepts false as a boolean answer', () => {
    const fields = [
      ...DEFAULT_RECEPTION_FIELDS,
      {
        fieldKey: 'newsletter',
        kind: 'custom' as const,
        fieldType: 'boolean' as const,
        enabled: true,
        required: true,
        label: 'お知らせ',
        customLabel: true,
        sortOrder: 7,
        options: [],
      },
    ]
    const row = declared({ ...blankRow('a', fields), name: '本田 康彦' })
    expect(missingRequiredFields(row, fields).map(field => field.fieldKey)).toEqual(['newsletter'])
    expect(canRegister(row, fields)).toBe(false)
    const answered = updateReceptionRowField(row, 'newsletter', false)
    const next = { ...row, ...answered }
    expect(missingRequiredFields(next, fields)).toEqual([])
    expect(canRegister(next, fields)).toBe(true)
  })
})

describe('blockedReason', () => {
  it('says the name when there is no name yet', () => {
    expect(blockedReason(blankRow('a'))).toBe('name')
  })

  // A filled-in name beside a disabled button reads as a bug, and the desk
  // retypes the name looking for what is wrong with it.
  it('says the declaration once the name is there', () => {
    expect(blockedReason({ ...blankRow('a'), name: '本田 康彦' })).toBe('declaration')
  })

  it('says nothing when the row is ready', () => {
    expect(blockedReason(declared({ ...blankRow('a'), name: '本田 康彦' }))).toBeNull()
  })
})

describe('correctedFields', () => {
  const row: ReceptionRow = {
    ...blankRow('a'),
    name: '本田 康彦',
    phone: '090-1234-5678',
    read: { name: '本田 廉彦', nameKana: '', phone: '090-1234-5678', email: '' },
  }

  it('names only the fields the desk changed', () => {
    expect(correctedFields(row)).toEqual(['name'])
  })

  it('does not call a field corrected when the reader proposed nothing', () => {
    const typed: ReceptionRow = { ...blankRow('a'), name: '西村 隆' }
    expect(isCorrected(typed, 'name')).toBe(false)
  })

  it('flags a misread the desk fixed', () => {
    expect(isCorrected(row, 'name')).toBe(true)
    expect(isCorrected(row, 'phone')).toBe(false)
  })

  it('detects corrected custom values without showing a value OCR did not read', () => {
    const fields = [{
      fieldKey: 'membership_class',
      kind: 'custom' as const,
      fieldType: 'select' as const,
      enabled: true,
      required: false,
      label: '会員区分',
      customLabel: true,
      sortOrder: 0,
      options: ['正会員', 'ゲスト'],
    }]
    const row = rowsFromDraft({
      visitors: [{ customFields: { membership_class: '正会員' } }],
      warnings: [],
    }, fields)[0]
    const edited = {
      ...row,
      ...updateReceptionRowField(row, 'membership_class', 'ゲスト'),
    }
    expect(isReceptionFieldCorrected(edited, fields[0])).toBe(true)
    expect(receptionRowValue(edited, 'membership_class')).toBe('ゲスト')
  })
})

describe('customerPayload', () => {
  it('sends absent rather than empty for what nobody asked', () => {
    const payload = customerPayload({ ...blankRow('a'), name: ' 本田 康彦 ' })
    expect(payload).toEqual({
      name: '本田 康彦',
      nameKana: null,
      phone: null,
      email: null,
      birthDate: null,
      sex: null,
      address: null,
      customFields: {},
      source: 'reception_sheet',
      sourceRowIndex: undefined,
      // Every box, unanswered ones included. The API needs to tell "not
      // ticked" from "not on this sheet"; it files neither.
      consents: [
        { key: 'golf_antisocial_and_course_terms', accepted: null },
        { key: 'golf_cart_terms', accepted: null },
        { key: 'golf_marketing_contact', accepted: null },
      ],
    })
  })

  it('sends what the desk confirmed, in the direction the API stores', () => {
    const row = declared({ ...blankRow('a'), name: '本田 康彦' })
    const payload = customerPayload({
      ...row,
      consents: { ...row.consents, golf_marketing_contact: false },
    })
    expect(payload.consents).toEqual([
      { key: 'golf_antisocial_and_course_terms', accepted: true },
      { key: 'golf_cart_terms', accepted: null },
      { key: 'golf_marketing_contact', accepted: false },
    ])
  })

  it('carries the line of the sheet so a duplicate can be traced back to the paper', () => {
    // The sheet itself is never stored, so this number is the only pointer at
    // the piece of paper the desk still has.
    const payload = customerPayload({ ...blankRow('a'), name: '本田 康彦' }, 2)
    expect(payload.source).toBe('reception_sheet')
    expect(payload.sourceRowIndex).toBe(2)
  })

  it('sends standard extras and custom answers in the registration contract', () => {
    const fields = [
      ...DEFAULT_RECEPTION_FIELDS,
      {
        fieldKey: 'membership_class',
        kind: 'custom' as const,
        fieldType: 'select' as const,
        enabled: true,
        required: true,
        label: '会員区分',
        customLabel: true,
        sortOrder: 7,
        options: ['正会員', 'ゲスト'],
      },
    ]
    const row = declared({ ...blankRow('a', fields), name: '本田 康彦' })
    let next = row
    next = { ...next, ...updateReceptionRowField(next, 'birth_date', '1978-04-03') }
    next = { ...next, ...updateReceptionRowField(next, 'sex', '女性') }
    next = {
      ...next,
      ...updateReceptionRowField(next, 'address', {
        postalCode: '100-0001',
        state: '東京都',
        city: '千代田区',
        address1: '千代田1-1-1',
        address2: 'サンプルビル',
      }),
    }
    next = { ...next, ...updateReceptionRowField(next, 'membership_class', '正会員') }
    expect(next.customFields).toEqual({ membership_class: '正会員' })
    expect(customerPayload(next, undefined, fields)).toMatchObject({
      birthDate: '1978-04-03',
      sex: '女性',
      address: {
        postalCode: '100-0001',
        address1: '千代田1-1-1',
      },
      customFields: { membership_class: '正会員' },
    })
  })
})

describe('duplicateNameKeys', () => {
  it('marks both rows so the desk decides, rather than dropping one', () => {
    const rows = [
      { ...blankRow('a'), name: '本田 康彦' },
      { ...blankRow('b'), name: '西村 隆' },
      { ...blankRow('c'), name: '本田 康彦' },
    ]
    expect(duplicateNameKeys(rows)).toEqual(new Set(['a', 'c']))
  })

  it('does not call two unnamed rows duplicates of each other', () => {
    expect(duplicateNameKeys([blankRow('a'), blankRow('b')]).size).toBe(0)
  })
})

describe('counting', () => {
  const rows: ReceptionRow[] = [
    declared({ ...blankRow('a'), name: '本田 康彦', status: 'saved' }),
    declared({ ...blankRow('b'), name: '西村 隆' }),
    blankRow('c'),
    // Named, but the declaration is still open: not ready to send either.
    { ...blankRow('d'), name: '山田 太郎' },
  ]

  it('counts what is still to register, excluding rows that are not ready', () => {
    expect(pendingRows(rows).map(row => row.key)).toEqual(['b'])
  })

  it('counts what this sheet has already put in the ledger', () => {
    expect(savedCount(rows)).toBe(1)
  })
})

describe('previewKind', () => {
  it('frames a PDF and shows an image directly', () => {
    expect(previewKind(file('application/pdf'))).toBe('pdf')
    expect(previewKind(file('image/png'))).toBe('image')
  })
})

describe('receptionReadFailure', () => {
  function apiError(status: number, code: string) {
    return new ApiError('server-authored English', status, { error: code, message: 'x' })
  }

  /**
   * The incident this exists for. An upstream reader out of credit used to
   * reach the desk as an empty draft plus the same sentence a blurry photo
   * gets, so the sheet was photographed again and again.
   */
  it('tells an upstream billing failure apart from an unreadable sheet', () => {
    expect(receptionReadFailure(apiError(402, 'reception_reader_billing_unsatisfied')))
      .toBe('billing')
  })

  it('recognises the two other reader failures', () => {
    expect(receptionReadFailure(apiError(429, 'reception_reader_rate_limited')))
      .toBe('rateLimited')
    expect(receptionReadFailure(apiError(424, 'reception_reader_unavailable')))
      .toBe('unavailable')
  })

  /** Everything else keeps the shared error copy rather than inventing one. */
  it('claims nothing it was not told', () => {
    expect(receptionReadFailure(apiError(400, 'bad_request'))).toBeNull()
    expect(receptionReadFailure(apiError(424, 'provider_error'))).toBeNull()
    expect(receptionReadFailure(new ApiError('Request failed with 402', 402))).toBeNull()
    expect(receptionReadFailure(new Error('offline'))).toBeNull()
    expect(receptionReadFailure(null)).toBeNull()
  })
})

describe('reception field settings', () => {
  it('provides the seven standard fields with name enabled and required', () => {
    expect(DEFAULT_RECEPTION_FIELDS.map(field => field.fieldKey)).toEqual([
      'name',
      'name_kana',
      'phone',
      'email',
      'birth_date',
      'sex',
      'address',
    ])
    expect(DEFAULT_RECEPTION_FIELDS[0]).toMatchObject({
      fieldKey: 'name',
      enabled: true,
      required: true,
    })
  })

  it('accepts camel and snake case DTOs and fills standards missing from an old server', () => {
    const fields = normalizeReceptionFields({
      items: [
        {
          fieldKey: 'nameKana',
          fieldType: 'text',
          enabled: false,
          required: false,
          label: '読みがな',
          sortOrder: 10,
        },
        {
          field_key: 'membership_class',
          kind: 'custom',
          field_type: 'select',
          enabled: true,
          required: true,
          label: '会員区分',
          sort_order: 1,
          options_json: '["正会員", "ゲスト"]',
        },
      ],
    })

    expect(fields).toContainEqual(expect.objectContaining({
      fieldKey: 'name_kana',
      enabled: false,
      label: '読みがな',
    }))
    expect(fields).toContainEqual(expect.objectContaining({
      fieldKey: 'membership_class',
      kind: 'custom',
      fieldType: 'select',
      options: ['正会員', 'ゲスト'],
    }))
    expect(fields.find(field => field.fieldKey === 'name')?.label).toBe('氏名')
    expect(fields.find(field => field.fieldKey === 'name')?.customLabel).toBe(false)
    expect(fields.find(field => field.fieldKey === 'membership_class')?.customLabel).toBe(true)
    expect(fields.filter(field => field.kind === 'standard')).toHaveLength(7)
  })

  it('uses safe defaults for malformed rows and aliases field keys', () => {
    expect(canonicalReceptionFieldKey('birthDate')).toBe('birth_date')
    expect(normalizeReceptionField({ fieldKey: 'phone', enabled: true }, 2))
      .toMatchObject({ fieldType: 'tel', label: '電話番号', customLabel: false, sortOrder: 2 })
    expect(normalizeReceptionField({ fieldKey: 'club_note', options: 'one\ntwo' }))
      .toMatchObject({ kind: 'custom', options: ['one', 'two'] })
    expect(normalizeReceptionField({ fieldType: 'text' })).toBeNull()
    expect(receptionFieldDefaultLabel('nameKana')).toBe('氏名のふりがな（カタカナ）')
    expect(receptionFieldDefaultLabel('club_note')).toBe('club_note')
  })

  it('normalizes a blank-form proposal and warns for unsupported fields', () => {
    const proposal = normalizeReceptionFormProposal({
      fields: [
        {
          fieldKey: 'customer_phone',
          enabled: true,
          required: true,
          label: 'ご連絡先',
        },
        {
          fieldKey: 'customer_subject',
          enabled: true,
          required: false,
          label: '会員区分',
        },
      ],
      customFields: [{ label: 'ハンディキャップ' }],
      warnings: ['原本を確認してください。'],
      previewImage: 'abc123',
    })
    expect(proposal.fields).toHaveLength(1)
    expect(proposal.fields[0]).toMatchObject({
      fieldKey: 'phone',
      enabled: true,
      required: true,
      label: 'ご連絡先',
    })
    expect(proposal.warnings).toEqual(expect.arrayContaining([
      '原本を確認してください。',
      '「会員区分」はCourseBoardの受付票項目として保存できないため、取り込みません。',
      '「ハンディキャップ」はCourseBoardの受付票項目として保存できないため、取り込みません。',
    ]))
    expect(receptionPreviewImageSrc(proposal.previewImage)).toBe('data:image/png;base64,abc123')
  })

  it('merges only proposed standards and preserves existing custom fields', () => {
    const custom: ReceptionField = {
      fieldKey: 'membership_class',
      kind: 'custom',
      fieldType: 'select',
      enabled: true,
      required: true,
      label: '会員区分',
      customLabel: true,
      sortOrder: 7,
      options: ['正会員', 'ゲスト'],
    }
    const current = [...DEFAULT_RECEPTION_FIELDS, custom]
    const proposal = normalizeReceptionFormProposal({
      fields: [
        { fieldKey: 'customer_phone', enabled: true, required: true, label: 'ご連絡先' },
        {
          fieldKey: 'membership_class',
          kind: 'custom',
          fieldType: 'select',
          enabled: false,
          required: false,
          label: '会員区分（更新）',
          options: ['正会員', 'ゲスト', '休会'],
        },
        {
          fieldKey: 'playing_style',
          kind: 'custom',
          fieldType: 'text',
          enabled: true,
          required: false,
          label: 'プレースタイル',
        },
      ],
      warnings: [],
    })
    const next = applyReceptionFormProposal(current, proposal)
    expect(next.find(field => field.fieldKey === 'phone')).toMatchObject({
      enabled: true,
      required: true,
      label: 'ご連絡先',
      customLabel: true,
    })
    // Absent standards and CourseBoard-owned custom definitions are untouched.
    expect(next.find(field => field.fieldKey === 'birth_date')).toEqual(
      DEFAULT_RECEPTION_FIELDS.find(field => field.fieldKey === 'birth_date'),
    )
    expect(next.find(field => field.fieldKey === 'membership_class')).toMatchObject({
      fieldKey: 'membership_class',
      enabled: false,
      label: '会員区分（更新）',
      options: ['正会員', 'ゲスト', '休会'],
    })
    expect(next.find(field => field.fieldKey === 'playing_style')).toMatchObject({
      kind: 'custom',
      label: 'プレースタイル',
      enabled: true,
    })
  })

  it('keeps the name invariant even if an analyzer suggests disabling it', () => {
    const proposal = normalizeReceptionFormProposal({
      fields: [{ fieldKey: 'name', enabled: false, required: false, label: '申込者' }],
      warnings: [],
    })
    const [name] = applyReceptionFormProposal(DEFAULT_RECEPTION_FIELDS, proposal)
    expect(name).toMatchObject({ enabled: true, required: true, label: '申込者' })
  })
})
