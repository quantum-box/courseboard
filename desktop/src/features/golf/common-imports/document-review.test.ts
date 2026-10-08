/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { businessValues, operationStorageKey, persistDocumentOperation, readDocumentOperation, remapReviewedRow, reviewedRows } from './document-review'
import type { DocumentImport } from './document-api'

const document = {
  rowField: 'rows', sources: [{ index: 0 }],
  extracted: { fields: { rows: [
    { _source_index: 0, _source_page: 12, _source_row: 1, cells: JSON.stringify({ facilityName: 'East', date: '10/8', dayPart: 'AM', groupCount: '2' }) },
    { _source_index: 0, _source_page: 12, _source_row: 2, cells: '{}' },
  ] }, warnings: [] },
} as unknown as DocumentImport
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
describe('document review recovery', () => {
  it('retains physical coordinates and unreadable rows without marking originals reviewed', () => {
    const rows = reviewedRows(document)
    expect(rows.map(row => row.source)).toEqual([{ fileIndex: 0, page: 12, row: 1 }, { fileIndex: 0, page: 12, row: 2 }])
    expect(rows.every(row => row.values.originalConfirmed === false)).toBe(true)
    expect(businessValues(rows[0]!)[0]).toMatchObject({ facilityName: 'East', dayPart: 'morning' })
    expect(businessValues(rows[1]!)[0].facilityName).toBe('')
    expect(document.extracted!.fields.rows).not.toEqual(rows)
  })
  it('restores saved exclusions and manual rows without modifying the saved revision', () => {
    const rows = reviewedRows(document)
    rows[0]!.values.manualRows = [{ facilityName: 'North', date: '10/9' }, { facilityName: 'South' }]
    rows[1]!.excludedReason = 'Not a reservation'
    const saved = { ...document, revision: { version: 1, sha256: 'a', rows } }
    const restored = reviewedRows(saved)
    expect(businessValues(restored[0]!)).toHaveLength(2)
    expect(restored[1]!.excludedReason).toBe('Not a reservation')
    restored[0]!.values.manualRows = []
    expect(businessValues(saved.revision.rows[0]!)).toHaveLength(2)
  })
  it('fails closed on missing physical coordinates', () => {
    const invalid = structuredClone(document)
    const rows = invalid.extracted!.fields.rows as Record<string, unknown>[]
    delete rows[0]!._source_page
    expect(() => reviewedRows(invalid)).toThrow()
  })
  it('keeps manual corrections when changing mappings, including explicitly emptied fields', () => {
    const original = reviewedRows(document)[0]!
    original.values.normalized = { ...businessValues(original)[0], groupCount: '99', date: '' }
    original.values.editedFields = ['date']
    original.values.originalConfirmed = true
    const updated = remapReviewedRow(original, {}, { facilityName: 'groupCount', groupCount: 'facilityName', date: 'facilityName' })
    expect(businessValues(updated)[0]).toMatchObject({ facilityName: '2', groupCount: '99', date: '' })
    expect(updated.values.originalConfirmed).toBe(false)
    expect(original.values.originalConfirmed).toBe(true)
  })
  it('persists one retry handle scoped to tenant, platform and actor without source data', () => {
    const key = operationStorageKey('tenant-a', 'platform-a', 'actor-a')
    const operation = { idempotencyKey: 'same-read', jobId: 'dtj_saved' }
    persistDocumentOperation(key, operation)
    expect(readDocumentOperation(key)).toEqual(operation)
    for (const scope of [['tenant-b', 'platform-a', 'actor-a'], ['tenant-a', 'platform-b', 'actor-a'], ['tenant-a', 'platform-a', 'actor-b']]) expect(readDocumentOperation(operationStorageKey(...scope as [string, string, string]))).toBeNull()
    expect(localStorage.getItem(key)).toBe(JSON.stringify(operation))
  })
  it('does not replace damaged or unpersistable retry handles with a new operation', () => {
    localStorage.setItem('operation', '{broken')
    expect(() => readDocumentOperation('operation')).toThrow()
    expect(localStorage.getItem('operation')).toBe('{broken')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => persistDocumentOperation('operation', { idempotencyKey: 'read' })).toThrow()
  })
})
