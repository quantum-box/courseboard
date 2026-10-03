import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../../api'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../../api', async importOriginal => {
  const original = await importOriginal<typeof import('../../../../api')>()
  return { ...original, courseboardApiJson: api.json }
})

import {
  analyzeReceptionForm,
  createReceptionConsentItem,
  draftReceptionSheets,
  listReceptionConsentItems,
  ReceptionBatchError,
} from './api'

describe('reception draft API adapter', () => {
  beforeEach(() => api.json.mockReset())
  afterEach(() => vi.unstubAllGlobals())

  it('uploads original sheets directly to Storage and advances the server job', async () => {
    const photo = new File(['a'], 'IMG_0001.jpg', { type: 'image/jpeg' })
    const scan = new File(['b'], 'scanner-0930.pdf', { type: 'application/pdf' })
    const storageFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', storageFetch)
    api.json
      .mockResolvedValueOnce({
        id: 'job-1',
        status: 'uploading',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
        uploads: [
          { storageKey: 'one', uploadUrl: 'https://storage.example/one', expiresAt: 'later' },
          { storageKey: 'two', uploadUrl: 'https://storage.example/two', expiresAt: 'later' },
        ],
      })
      .mockResolvedValueOnce({
        id: 'job-1',
        status: 'ready',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
      })
      .mockResolvedValueOnce({
        id: 'job-1',
        status: 'completed',
        completedUnits: 2,
        totalUnits: 2,
        draft: { visitors: [{ name: '本田 康彦' }], warnings: [] },
      })

    await expect(draftReceptionSheets([photo, scan])).resolves.toMatchObject({
      visitors: [{ name: '本田 康彦' }],
      warnings: [],
    })

    const [path, init] = api.json.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/v1/course/customers/reception-draft/jobs')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      sheets: [
        { contentType: 'image/jpeg', size: photo.size },
        { contentType: 'application/pdf', size: scan.size },
      ],
    })
    expect(String(init.body)).not.toContain('IMG_0001.jpg')
    expect(storageFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://storage.example/one',
      'https://storage.example/two',
    ])
    expect(storageFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: photo,
    })
    expect(new Headers(storageFetch.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false)
    expect(api.json.mock.calls.map(([url]) => url)).toEqual([
      '/v1/course/customers/reception-draft/jobs',
      '/v1/course/customers/reception-draft/jobs/job-1/confirm',
      '/v1/course/customers/reception-draft/jobs/job-1/advance',
    ])
  })

  it('reuses the same job key after a transient advance failure', async () => {
    const photo = new File(['a'], 'scan.jpg', { type: 'image/jpeg' })
    api.json
      .mockResolvedValueOnce({
        id: 'job-retry',
        status: 'uploading',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
        uploads: [{ storageKey: 'one', uploadUrl: 'mock://one', expiresAt: 'later' }],
      })
      .mockResolvedValueOnce({
        id: 'job-retry',
        status: 'ready',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
      })
      .mockRejectedValueOnce(new ApiError('reader unavailable', 429))
      .mockResolvedValueOnce({
        id: 'job-retry',
        status: 'running',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
      })

    let caught: ReceptionBatchError | undefined
    try {
      await draftReceptionSheets([photo])
    } catch (error) {
      if (error instanceof ReceptionBatchError) caught = error
    }
    expect(caught?.jobResume).toMatchObject({ jobId: 'job-retry' })
    const resume = caught?.jobResume
    expect(resume).toBeDefined()

    api.json
      .mockResolvedValueOnce({
        id: 'job-retry',
        status: 'running',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
      })
      .mockResolvedValueOnce({
        id: 'job-retry',
        status: 'completed',
        completedUnits: 1,
        totalUnits: 1,
        draft: { visitors: [{ name: '西村 隆' }], warnings: [] },
      })
    await expect(draftReceptionSheets(
      [photo],
      {},
      {
        draft: caught!.partialDraft,
        nextBatchIndex: caught!.nextBatchIndex,
        job: resume,
      },
    )).resolves.toMatchObject({ visitors: [{ name: '西村 隆' }] })
    expect(JSON.parse(String((api.json.mock.calls[4]?.[1] as RequestInit).body)).idempotencyKey)
      .toBe(JSON.parse(String((api.json.mock.calls[0]?.[1] as RequestInit).body)).idempotencyKey)
    expect(api.json.mock.calls.slice(4).map(([path]) => path)).toEqual([
      '/v1/course/customers/reception-draft/jobs',
      '/v1/course/customers/reception-draft/jobs/job-retry/advance',
    ])
  })

  it('checks progress after a concurrent advance conflict', async () => {
    const photo = new File(['a'], 'scan.jpg', { type: 'image/jpeg' })
    api.json
      .mockResolvedValueOnce({
        id: 'job-busy',
        status: 'uploading',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
        uploads: [{ storageKey: 'one', uploadUrl: 'mock://one', expiresAt: 'later' }],
      })
      .mockResolvedValueOnce({
        id: 'job-busy',
        status: 'ready',
        completedUnits: 0,
        draft: { visitors: [], warnings: [] },
      })
      .mockRejectedValueOnce(new ApiError('another advance is in flight', 409))
      .mockResolvedValueOnce({
        id: 'job-busy',
        status: 'completed',
        completedUnits: 1,
        totalUnits: 1,
        draft: { visitors: [{ name: '田中 花子' }], warnings: [] },
      })

    await expect(draftReceptionSheets([photo])).resolves.toMatchObject({
      visitors: [{ name: '田中 花子' }],
    })
    expect(api.json.mock.calls.map(([path]) => path)).toEqual([
      '/v1/course/customers/reception-draft/jobs',
      '/v1/course/customers/reception-draft/jobs/job-busy/confirm',
      '/v1/course/customers/reception-draft/jobs/job-busy/advance',
      '/v1/course/customers/reception-draft/jobs/job-busy',
    ])
  })
})

describe('reception consent API adapter', () => {
  it('lists inactive consent definitions when requested', async () => {
    api.json.mockResolvedValueOnce({
      items: [{
        id: 'mci_1',
        consent_key: 'terms',
        label: 'Terms',
        required: true,
        active: false,
        terms_version: '3',
        sort_order: 4,
      }],
    })

    await expect(listReceptionConsentItems({ includeInactive: true })).resolves.toEqual([{
      id: 'mci_1',
      consentKey: 'terms',
      label: 'Terms',
      body: null,
      required: true,
      termsVersion: '3',
      active: false,
      sortOrder: 4,
    }])
    expect(api.json).toHaveBeenCalledWith(
      '/v1/course/customer-consent-items?includeInactive=true',
      undefined,
    )
  })

  it('creates a consent item through CourseBoard and normalizes the response', async () => {
    api.json.mockResolvedValueOnce({
      item: {
        id: 'mci_1',
        consentKey: 'terms',
        label: 'Terms',
        body: 'Read this',
        required: true,
        active: true,
        termsVersion: '1',
        sortOrder: 2,
      },
    })
    const input = {
      body: 'Read this',
      consentKey: 'terms',
      label: 'Terms',
      required: true,
      sortOrder: 2,
      termsVersion: '1',
    }
    await expect(createReceptionConsentItem(input)).resolves.toMatchObject(input)
    expect(api.json).toHaveBeenCalledWith(
      '/v1/course/customer-consent-items',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
  })

  it('keeps consentItems additive and defaults it when an old analyzer omits it', async () => {
    api.json.mockResolvedValueOnce({
      fields: [],
      warnings: [],
      consentItems: [{
        suggestedKey: 'terms',
        label: 'Terms',
        body: null,
        required: true,
      }],
    })
    await expect(analyzeReceptionForm(new File(['form'], 'form.jpg', { type: 'image/jpeg' })))
      .resolves.toMatchObject({
        fields: [],
        consentItems: [{ consentKey: 'terms', label: 'Terms', required: true }],
      })

    api.json.mockResolvedValueOnce({ fields: [], warnings: [] })
    await expect(analyzeReceptionForm(new File(['form'], 'form.jpg', { type: 'image/jpeg' })))
      .resolves.toMatchObject({ consentItems: [] })
  })
})
