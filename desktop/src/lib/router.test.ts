import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentRoute, currentRouteSearchParams } from './router'

afterEach(() => vi.unstubAllGlobals())

describe('hash routing', () => {
  it('keeps hash query parameters out of the route', () => {
    vi.stubGlobal('window', {
      location: {
        hash: '#/cancellation-fees/new?orderId=ord_1',
        search: '',
      },
    })

    expect(currentRoute()).toBe('cancellation-fees/new')
    expect(currentRouteSearchParams().get('orderId')).toBe('ord_1')
  })

  it('lets a hash query override the top-level query', () => {
    vi.stubGlobal('window', {
      location: {
        hash: '#/cancellation-fees/new?orderId=ord_hash',
        search: '?orderId=ord_top&mode=sandbox',
      },
    })

    const params = currentRouteSearchParams()
    expect(params.get('orderId')).toBe('ord_hash')
    expect(params.get('mode')).toBe('sandbox')
  })
})
