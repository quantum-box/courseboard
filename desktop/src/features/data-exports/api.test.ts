import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createExportDefinition, downloadExportCsv, emptyExportDraft, exportDraftError,
  loadDataExports, type ExportDefinition, type ExportDraft,
} from './api'

const api = vi.hoisted(() => ({ tenant: 'tenant-a', json: vi.fn(), course: vi.fn(), text: vi.fn(), download: vi.fn() }))
vi.mock('../../api', async original => ({
  ...await original<typeof import('../../api')>(),
  fieldTenant: () => api.tenant, courseboardApiJson: api.course, fieldApiJson: api.json, fieldApiText: api.text, downloadBlob: api.download,
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
  beforeEach(() => { vi.clearAllMocks(); api.tenant = 'tenant-a' })

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
  it('combines Field sources with the authorized CourseBoard catalogue when the renderer is available', async () => {
    api.json.mockImplementation((path: string) => Promise.resolve(path.endsWith('/objects')
      ? { clientDataSupported: true, items: [{ key: 'customer' }] }
      : { items: [] }))
    api.course.mockResolvedValue({ items: [{ key: 'external:courseboard:reception' }] })
    expect((await loadDataExports()).objects.map(object => object.key)).toEqual(['external:courseboard:reception', 'customer'])
  })

  it('renders all reception pages through Field, selects custom answers and preserves quoted multiline headers once', async () => {
    const local = { ...definition, sourceObject: 'external:courseboard:reception', mapping: { fields: [
      { source: 'name', target: 'Name\n姓名', required: false, approved: true },
      { source: 'custom.answer', target: 'Answer', required: false, approved: true },
    ] } }
    const header = '"Name\n姓名","Answer"\n'
    api.text.mockResolvedValueOnce(header).mockResolvedValueOnce(header + '"山田","a,b"\n').mockResolvedValueOnce(header + '"佐藤","false"\n')
    api.course.mockResolvedValueOnce({ items: [{ name: '山田', 'custom.answer': 'a,b', privateNote: 'omit' }], nextOffset: 100 })
      .mockResolvedValueOnce({ items: [{ name: '佐藤', 'custom.answer': false }], nextOffset: null })
    await downloadExportCsv(local, '2026-09')
    expect(api.course.mock.calls[1]?.[0]).toContain('offset=100&yearMonth=2026-09')
    expect(api.text.mock.calls.every(([path]) => path.endsWith('/render'))).toBe(true)
    expect(JSON.parse(api.text.mock.calls[1]![1].body)).toEqual({ rows: [{ name: '山田', 'custom.answer': 'a,b' }] })
    const blob = api.download.mock.calls[0]![1] as Blob
    expect(await blob.text()).toBe(header + '"山田","a,b"\n"佐藤","false"\n')
  })

  it('saves no partial file if a later page fails or pagination stops advancing', async () => {
    const local = { ...definition, sourceObject: 'external:courseboard:reception' }
    api.text.mockResolvedValue('"Name"\n')
    api.course.mockResolvedValueOnce({ items: [{ name: 'A' }], nextOffset: 100 }).mockRejectedValueOnce(new Error('upstream'))
    await expect(downloadExportCsv(local)).rejects.toThrow('upstream')
    expect(api.download).not.toHaveBeenCalled()
    api.course.mockResolvedValueOnce({ items: [], nextOffset: 100 })
    await expect(downloadExportCsv(local)).rejects.toThrow('最後まで')
    expect(api.download).not.toHaveBeenCalled()
  })

  it('does not save a file if the tenant changes during the export', async () => {
    api.text.mockImplementationOnce(async () => { api.tenant = 'tenant-b'; return '"Name"\n"A"\n' })
    await expect(downloadExportCsv(definition)).rejects.toThrow()
    expect(api.download).not.toHaveBeenCalled()
  })

})
