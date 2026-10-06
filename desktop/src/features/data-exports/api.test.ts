import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createExportDefinition, downloadExportCsv, emptyExportDraft, exportDraftError,
  type ExportDefinition, type ExportDraft,
} from './api'

const api = vi.hoisted(() => ({ json: vi.fn(), text: vi.fn(), download: vi.fn() }))
vi.mock('../../api', async original => ({
  ...await original<typeof import('../../api')>(),
  fieldApiJson: api.json, fieldApiText: api.text, downloadBlob: api.download,
  today: () => '2026-10-07',
}))

const draft: ExportDraft = {
  name: ' 予約出力 ', description: '', sourceObject: 'reservation', status: 'active',
  columns: [
    { field: 'customer_name', label: '顧客名', target: ' お客様 ', included: true },
    { field: 'starts_at', label: '開始日時', target: '日時', included: false },
    { field: 'reservation_number', label: '予約番号', target: '予約番号', included: true },
  ],
}
const definition: ExportDefinition = {
  id: 'bxd/a b', name: '予約/出力', sourceObject: 'reservation',
  destinationType: 'csv', status: 'active', mapping: { fields: [] },
}

describe('Field shared data exports', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves selected columns in their chosen order using the Field mapping contract', async () => {
    await createExportDefinition(draft)
    const [path, init] = api.json.mock.calls[0]!
    expect(path).toBe('/v1/bridge/exports/definitions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      name: '予約出力', sourceObject: 'reservation', destinationType: 'csv', status: 'active',
      mapping: { fields: [
        { source: 'customer_name', target: 'お客様', required: false, approved: true },
        { source: 'reservation_number', target: '予約番号', required: false, approved: true },
      ] },
    })
  })

  it('refuses missing names, empty selections and duplicate trimmed headers before saving', () => {
    expect(exportDraftError(emptyExportDraft())).toContain('設定名')
    expect(exportDraftError({ ...draft, columns: [] })).toContain('1つ以上')
    const duplicate = { ...draft, columns: draft.columns.map(column => ({
      ...column, included: true, target: ' 同じ名前 ',
    })) }
    expect(() => createExportDefinition(duplicate)).toThrow('重複')
    expect(api.json).not.toHaveBeenCalled()
  })

  it('downloads the server CSV with a single BOM, safe filename and encoded definition id', async () => {
    api.text.mockResolvedValue('\uFEFF顧客名,備考\n山田,"a,b"\n')
    await downloadExportCsv(definition)
    expect(api.text.mock.calls[0]?.[0]).toBe('/v1/bridge/exports/definitions/bxd%2Fa%20b/csv')
    const [filename, blob] = api.download.mock.calls[0]! as [string, Blob]
    expect(filename).toBe('予約_出力_2026-10-07.csv')
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 6)))
      .toEqual([239, 187, 191, 233, 161, 167])
    expect(await blob.text()).toBe('顧客名,備考\n山田,"a,b"\n')
  })

  it('never starts a file download when the settings are inactive or the API rejects the export', async () => {
    await expect(downloadExportCsv({ ...definition, status: 'inactive' })).rejects.toThrow()
    expect(api.text).not.toHaveBeenCalled()
    api.text.mockRejectedValue(new Error('403'))
    await expect(downloadExportCsv(definition)).rejects.toThrow('403')
    expect(api.download).not.toHaveBeenCalled()
  })
})
