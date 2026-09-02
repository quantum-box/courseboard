import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../../api', () => ({
  courseboardApiJson: api.json,
}))

import {
  analyzeReceptionForm,
  createReceptionConsentItem,
  listReceptionConsentItems,
} from './api'

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
