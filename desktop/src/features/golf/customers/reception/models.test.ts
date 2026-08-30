import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  blankRow,
  canRegister,
  correctedFields,
  customerPayload,
  duplicateNameKeys,
  fileValidationError,
  isCorrected,
  pendingRows,
  prepareReceptionSheet,
  previewKind,
  rowsFromDraft,
  savedCount,
  sniffSheetBytes,
  uploadFileName,
  MAX_RECEPTION_SHEET_BYTES,
  RECEPTION_SHEET_ACCEPT,
  type ReceptionRow,
} from './models'

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
  it('registers on a name alone, like the ledger form', () => {
    expect(canRegister({ ...blankRow('a'), name: '本田 康彦' })).toBe(true)
  })

  it('refuses a row with nothing but whitespace in the name', () => {
    expect(canRegister({ ...blankRow('a'), name: '   ' })).toBe(false)
  })

  it('does not register the same row twice', () => {
    const saved: ReceptionRow = { ...blankRow('a'), name: '本田 康彦', status: 'saved' }
    expect(canRegister(saved)).toBe(false)
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
})

describe('customerPayload', () => {
  it('sends absent rather than empty for what nobody asked', () => {
    const payload = customerPayload({ ...blankRow('a'), name: ' 本田 康彦 ' })
    expect(payload).toEqual({ name: '本田 康彦', nameKana: null, phone: null, email: null })
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
    { ...blankRow('a'), name: '本田 康彦', status: 'saved' },
    { ...blankRow('b'), name: '西村 隆' },
    blankRow('c'),
  ]

  it('counts what is still to register, excluding the nameless row', () => {
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
