import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api'
import { deliveryDecision, hasUnresolvedDelivery, routeDeliveryDecision } from './FeatureDelivery'
import { evaluateFeatureDeliveries, resolveFeatureDeliveries } from './feature-delivery-api'
import { FEATURE_KEYS } from './routeFeatures'
import { fetchTenantTimezone } from '../context/tenantTimezoneApi'

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, courseboardApiJson: vi.fn() }
})

const api = await import('../api')
const courseboardApiJson = vi.mocked(api.courseboardApiJson)

afterEach(() => {
  courseboardApiJson.mockReset()
})

const enforced = (values: Record<string, { enabled: boolean; resolved: boolean }>) => ({
  enforcement: 'enforce' as const,
  values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { key, ...value }])),
  error: false,
  isLoading: false,
})

describe('deliveryDecision', () => {
  it('gates nothing while enforcement is off or in shadow', () => {
    for (const enforcement of ['off', 'shadow'] as const) {
      expect(deliveryDecision('courseboard.courses', { ...enforced({}), enforcement })).toBe(true)
    }
  })

  it('follows the server under enforcement and holds an unknown answer', () => {
    const context = enforced({
      'courseboard.courses': { enabled: true, resolved: true },
      'courseboard.budgets': { enabled: false, resolved: true },
      'courseboard.settlement': { enabled: false, resolved: false },
    })
    expect(deliveryDecision('courseboard.courses', context)).toBe(true)
    expect(deliveryDecision('courseboard.budgets', context)).toBe(false)
    expect(deliveryDecision('courseboard.settlement', context)).toBeNull()
    expect(deliveryDecision('courseboard.staff', context)).toBeNull()
  })

  it('holds every gated screen until the first answer, but not ungated ones', () => {
    const loading = { enforcement: null, values: {}, error: false, isLoading: true }
    expect(routeDeliveryDecision('golf/ledger', loading)).toBeNull()
    expect(routeDeliveryDecision('golf', loading)).toBe(true)
    expect(routeDeliveryDecision('unknown/route', loading)).toBe(true)
    const failed = { enforcement: null, values: {}, error: true, isLoading: false }
    expect(routeDeliveryDecision('golf/ledger', failed)).toBeNull()
  })

  it('closes a screen when any feature it loads is not provided', () => {
    const context = enforced({
      'courseboard.caddies.shifts': { enabled: true, resolved: true },
      'courseboard.caddies': { enabled: true, resolved: true },
      'courseboard.caddies.availability': { enabled: true, resolved: true },
      'courseboard.courses': { enabled: true, resolved: true },
      'courseboard.caddies.dispatch': { enabled: false, resolved: true },
    })
    expect(routeDeliveryDecision('golf/caddies/shifts', context)).toBe(false)
  })

  it('gates nothing without a provider', () => {
    expect(routeDeliveryDecision('golf/ledger', null)).toBe(true)
  })
})

describe('embedded controls', () => {
  it('drop a child feature the plan leaves out while the parent screen stays', () => {
    const context = enforced({
      'courseboard.tee_sheet': { enabled: true, resolved: true },
      'courseboard.courses': { enabled: true, resolved: true },
      'courseboard.tee_sheet.checkin': { enabled: false, resolved: true },
    })
    expect(deliveryDecision('courseboard.tee_sheet', context)).toBe(true)
    expect(deliveryDecision('courseboard.tee_sheet.checkin', context)).toBe(false)
  })
})

describe('evaluateFeatureDeliveries', () => {
  it('reads a malformed answer as enforced and unresolved', () => {
    const result = resolveFeatureDeliveries(['courseboard.courses'], {
      enforcement: 'maybe',
      values: [{ key: 'courseboard.courses', enabled: true }, { key: 'other', enabled: true, resolved: true }],
    })
    expect(result.enforcement).toBe('enforce')
    expect(result.values).toEqual({
      'courseboard.courses': { key: 'courseboard.courses', enabled: true, resolved: false },
    })
  })

  it('reads a server that predates the endpoint as off', async () => {
    for (const status of [403, 404]) {
      courseboardApiJson.mockRejectedValueOnce(new ApiError('no such route', status))
      await expect(evaluateFeatureDeliveries(['courseboard.courses'])).resolves.toEqual({
        enforcement: 'off',
        values: {},
      })
    }
  })

  it('leaves any other failure to the caller', async () => {
    courseboardApiJson.mockRejectedValueOnce(new ApiError('down', 503))
    await expect(evaluateFeatureDeliveries(['courseboard.courses'])).rejects.toThrow('down')
  })
})

describe('hasUnresolvedDelivery', () => {
  const all = (resolved: boolean) => Object.fromEntries(FEATURE_KEYS.map(key => [key, { key, enabled: true, resolved }]))

  it('treats a 200 with any unresolved or missing key as a retryable failure', () => {
    expect(hasUnresolvedDelivery({ enforcement: 'enforce', values: all(true) })).toBe(false)
    expect(hasUnresolvedDelivery({ enforcement: 'enforce', values: all(false) })).toBe(true)
    const { 'courseboard.courses': _omitted, ...missingOne } = all(true)
    expect(hasUnresolvedDelivery({ enforcement: 'enforce', values: missingOne })).toBe(true)
  })

  it('never flags anything while enforcement is off', () => {
    expect(hasUnresolvedDelivery({ enforcement: 'off', values: {} })).toBe(false)
  })
})

describe('fetchTenantTimezone', () => {
  it('reads the narrow endpoint', async () => {
    courseboardApiJson.mockResolvedValueOnce({ timezone: 'Asia/Tokyo' })
    await expect(fetchTenantTimezone()).resolves.toEqual({ configJson: { timezone: 'Asia/Tokyo' } })
    expect(courseboardApiJson).toHaveBeenCalledWith('/v1/course/tenant-timezone')
  })

  it.each([403, 404])('never falls back to the full extension status on %s', async status => {
    courseboardApiJson.mockReset()
    courseboardApiJson.mockRejectedValueOnce(new ApiError('refused', status))
    await expect(fetchTenantTimezone()).rejects.toThrow('refused')
    expect(courseboardApiJson).toHaveBeenCalledTimes(1)
    expect(courseboardApiJson).not.toHaveBeenCalledWith('/v1/course/extension-status')
  })
})
