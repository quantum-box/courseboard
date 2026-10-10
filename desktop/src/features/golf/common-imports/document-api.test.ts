import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ json: vi.fn(), blob: vi.fn(), digest: vi.fn() }))
vi.mock('../../../api', () => ({ courseboardApiJson: mocks.json, courseboardApiBlob: mocks.blob }))
vi.mock('./api', () => ({ fileDigest: mocks.digest, getJob: vi.fn() }))
import { executeDocumentRevision, fetchDocumentOriginal, reserveReceptionDocumentImport, reserveReservationDocument, saveDocumentRevision, stepDocumentRead, uploadDocumentSources } from './document-api'
import type { ImportJob } from './api'
const hash = 'a'.repeat(64)
const file = new File(['source'], 'source.pdf', { type: 'application/pdf' })
const job = { id: 'dtj_1', document: { ocrJobId: 'goj_1', manifestSha256: 'b'.repeat(64), sources: [{ index: 0, size: file.size, contentType: file.type, sha256: hash, rotation: 0 }], ocrStatus: 'completed', revisionVersion: 3, executionAvailable: false } } as ImportJob
beforeEach(() => { vi.clearAllMocks(); mocks.digest.mockResolvedValue(hash) })
describe('common document import adapter', () => {
  it('reserves immutable input and links the existing OCR id before any upload', async () => {
    mocks.json.mockResolvedValueOnce({ id: 'goj_1', status: 'uploading', uploads: [] }).mockResolvedValueOnce(job)
    await reserveReceptionDocumentImport([file], 'stable-operation', new AbortController().signal)
    const body = JSON.parse(mocks.json.mock.calls[0]![1].body)
    expect(body).toEqual({ idempotencyKey: 'stable-operation', sheets: [{ contentType: file.type, size: file.size, sha256: hash }] })
    expect(JSON.parse(mocks.json.mock.calls[1]![1].body)).toEqual({ ocrJobId: 'goj_1' })
    expect(mocks.json).toHaveBeenCalledTimes(2)
  })
  it('rejects changed server manifests without creating another OCR job', async () => {
    mocks.json.mockResolvedValueOnce({ id: 'goj_1' }).mockResolvedValueOnce({ ...job, document: { ...job.document!, sources: [{ ...job.document!.sources[0]!, sha256: 'c'.repeat(64) }] } })
    await expect(reserveReceptionDocumentImport([file], 'stable-operation', new AbortController().signal)).rejects.toThrow('一致しません')
    expect(mocks.json).toHaveBeenCalledTimes(2)
  })
  it('validates limits before contacting either API', async () => {
    for (const files of [[], Array(33).fill(file), [new File(['x'], 'x.txt', { type: 'text/plain' })]]) await expect(reserveReceptionDocumentImport(files, 'stable-operation', new AbortController().signal)).rejects.toThrow()
    expect(mocks.json).not.toHaveBeenCalled()
  })
  it('reads through the same OCR id and synchronizes without business registration', async () => {
    mocks.json.mockResolvedValueOnce({}).mockResolvedValueOnce(job)
    await stepDocumentRead(job, 'advance', new AbortController().signal)
    expect(mocks.json.mock.calls.map(call => call[0])).toEqual(['/v1/course/customers/reception-draft/jobs/goj_1/advance', '/v1/course/data-imports/jobs/dtj_1/document-sync'])
  })
  it('binds edits to the exact source and revision', async () => {
    const rows = [{ source: { fileIndex: 0, page: 1, row: 1 }, values: { name: '修正' } }]
    mocks.json.mockResolvedValue(job)
    await saveDocumentRevision(job, rows)
    expect(JSON.parse(mocks.json.mock.calls[0]![1].body)).toEqual({ manifestSha256: 'b'.repeat(64), expectedVersion: 3, rows })
  })
  it('does no PUT if any reselected source has a different hash', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mocks.digest.mockResolvedValue('c'.repeat(64))
    await expect(uploadDocumentSources(job, { id: 'goj_1', status: 'uploading', uploads: [{ storageKey: 'key', uploadUrl: 'https://storage.example/source', expiresAt: '2099' }] }, [file], new AbortController().signal)).rejects.toThrow('同じ文書')
    expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore()
  })
  it('reserves PDF rotation, year and selected physical pages under the retained operation', async () => {
    const rotated = { ...job, document: { ...job.document!, sources: [{ ...job.document!.sources[0]!, rotation: 90 }] } }
    mocks.json.mockResolvedValue({ job: rotated, ocr: { id: 'goj_1', status: 'uploading', uploads: [] } })
    const result = await reserveReservationDocument([file], [90], '12-13', { year: 2026 }, 'retained', new AbortController().signal)
    expect(result.ocr).toEqual({ id: 'goj_1', status: 'uploading', uploads: [] })
    expect(result.job).toEqual(rotated)
    expect(JSON.parse(mocks.json.mock.calls[0]![1].body)).toEqual({ idempotencyKey: 'retained', documents: [{ contentType: file.type, size: file.size, sha256: hash, rotation: 90 }], pages: '12-13', importOptions: { year: 2026 } })
    expect(mocks.json.mock.calls[0]![0]).toContain('/courseboardReservationReports/imports/document-upload')
  })
  it('normalizes a signature-checked PDF with omitted MIME for reservation and resumed upload', async () => {
    const pdf = new File(['%PDF-1.7\nsource'], '予約表.PDF')
    const normalized = { ...job, document: { ...job.document!, sources: [{ ...job.document!.sources[0]!, size: pdf.size, contentType: 'application/pdf' }] } }
    const ocr = { id: 'goj_1', status: 'uploading', uploads: [{ storageKey: 'key', uploadUrl: 'https://storage.example/source', expiresAt: '2099' }] }
    mocks.json.mockResolvedValue({ job: normalized, ocr })
    const signal = new AbortController().signal
    await reserveReservationDocument([pdf], [0], '', { year: 2026 }, 'retained', signal)
    expect(JSON.parse(mocks.json.mock.calls[0]![1].body).documents[0].contentType).toBe('application/pdf')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    try {
      await uploadDocumentSources(normalized, ocr, [new File([pdf], pdf.name)], signal)
      expect(fetchSpy).toHaveBeenCalledOnce()
      expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ headers: { 'Content-Type': 'application/pdf' }, credentials: 'omit', redirect: 'error' })
    } finally { fetchSpy.mockRestore() }
  })
  it('rejects omitted MIME without a PDF name and signature before reservation or upload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      for (const invalid of [new File(['not a PDF'], 'source.pdf'), new File(['%PDF-1.7'], 'source.txt')]) {
        const normalized = { ...job, document: { ...job.document!, sources: [{ ...job.document!.sources[0]!, size: invalid.size, contentType: 'application/pdf' }] } }
        await expect(reserveReservationDocument([invalid], [0], '', { year: 2026 }, 'retained', new AbortController().signal)).rejects.toThrow()
        await expect(uploadDocumentSources(normalized, { id: 'goj_1', status: 'uploading', uploads: [{ storageKey: 'key', uploadUrl: 'https://storage.example/source', expiresAt: '2099' }] }, [invalid], new AbortController().signal)).rejects.toThrow()
      }
      expect(mocks.json).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally { fetchSpy.mockRestore() }
  })
  it('binds execution to the manifest and exact saved revision, without reading again', async () => {
    const reviewed = { ...job, document: { ...job.document!, revisionSha256: 'c'.repeat(64) } }
    mocks.json.mockResolvedValue(reviewed)
    await executeDocumentRevision(reviewed, 'confirm')
    expect(JSON.parse(mocks.json.mock.calls[0]![1].body)).toEqual({ manifestSha256: 'b'.repeat(64), revisionVersion: 3, revisionSha256: 'c'.repeat(64) })
    expect(mocks.json).toHaveBeenCalledTimes(1)
    expect(mocks.json.mock.calls[0]![0]).toBe('/v1/course/data-imports/jobs/dtj_1/document-confirm')
  })
  it('views originals through the authorized BFF and rejects modified bytes', async () => {
    mocks.blob.mockResolvedValue(file)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const signal = new AbortController().signal
    expect((await fetchDocumentOriginal(job, 0, signal)).size).toBe(file.size)
    expect(mocks.blob).toHaveBeenCalledWith('/v1/course/data-imports/jobs/dtj_1/document-original/0', { signal })
    expect(fetchSpy).not.toHaveBeenCalled()
    mocks.digest.mockResolvedValue('d'.repeat(64))
    await expect(fetchDocumentOriginal(job, 0, signal)).rejects.toThrow('一致しません')
    mocks.digest.mockResolvedValue(hash)
    mocks.blob.mockResolvedValue(new Blob(['longer source']))
    await expect(fetchDocumentOriginal(job, 0, signal)).rejects.toThrow('一致しません')
    fetchSpy.mockRestore()
  })
})
