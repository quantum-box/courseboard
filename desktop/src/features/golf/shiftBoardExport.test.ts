import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  shiftExportCsv,
  shiftExportXlsx,
  type ShiftExportDocument,
} from './shiftBoardExport'

const document: ShiftExportDocument = {
  title: '2026-08 確定シフト表',
  note: '出=割当あり / 可=出られる',
  sheetName: '月間シフト',
  headers: ['キャディ', '在籍状態', '連続', '1 土', '2 日'],
  headerWeekends: [null, null, null, 'saturday', 'sunday'],
  rows: [{
    values: ['高田, 卓哉', '在籍中', '6日', '可 東', '休'],
    employmentStatus: 'active',
    dayStyles: [
      { kind: 'available', weekend: 'saturday', longStreak: false, changed: false, pinned: false },
      { kind: 'off', weekend: 'sunday', longStreak: false, changed: false, pinned: false },
    ],
  }],
}

describe('shift board exports', () => {
  it('creates a BOM-prefixed CSV and escapes names containing commas', () => {
    const csv = shiftExportCsv(document)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"高田, 卓哉",在籍中,6日,可 東,休\r\n')
  })

  it('creates an XLSX workbook with the complete worksheet contract', async () => {
    const workbook = unzipSync(await shiftExportXlsx(document))
    expect(Object.keys(workbook)).toContain('xl/worksheets/sheet1.xml')
    const sheet = strFromU8(workbook['xl/worksheets/sheet1.xml'] as Uint8Array)
    expect(sheet).toContain('<dimension ref="A1:E4"/>')
    expect(sheet).toContain('<pane xSplit="3" ySplit="3"')
    expect(sheet).toContain('<autoFilter ref="A3:E4"/>')
    expect(sheet).toContain('高田, 卓哉')
  })
})
