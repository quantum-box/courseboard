import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ json: vi.fn(), digest: vi.fn() }))
vi.mock('../../../api', () => ({ courseboardApiJson: mocks.json }))
vi.mock('./api', () => ({ fileDigest: mocks.digest, getJob: vi.fn() }))
import { reserveReceptionDocumentImport, saveDocumentRevision, stepDocumentRead, uploadDocumentSources } from './document-api'
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
})
