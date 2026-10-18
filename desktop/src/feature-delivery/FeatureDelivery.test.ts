import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api'
import { deliveryDecision, routeDeliveryDecision } from './FeatureDelivery'
import { evaluateFeatureDeliveries, resolveFeatureDeliveries } from './feature-delivery-api'

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

  it('gates nothing without a provider', () => {
    expect(routeDeliveryDecision('golf/ledger', null)).toBe(true)
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
