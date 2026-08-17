import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adoptLegacyLocation,
  currentRoute,
  currentRouteSearchParams,
  currentTenantId,
  goBack,
  navigate,
  registerNavigationGuard,
  replaceTenantId,
} from './router'

afterEach(() => vi.unstubAllGlobals())

function stubLocation(url: string) {
  const parsed = new URL(url)
  vi.stubGlobal('window', {
    location: {
      href: parsed.href,
      protocol: parsed.protocol,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
  })
}

describe('reading a location', () => {
  it('takes the tenant off the front of the path', () => {
    stubLocation('http://localhost/tn_1/golf/ledger?date=2026-08-12')

    expect(currentTenantId()).toBe('tn_1')
    expect(currentRoute()).toBe('golf/ledger')
    expect(currentRouteSearchParams().get('date')).toBe('2026-08-12')
  })

  it('reads a link that names no tenant', () => {
    // The first segment is a route the app renders, so it is not a club.
    stubLocation('http://localhost/golf/ledger')

    expect(currentTenantId()).toBeNull()
    expect(currentRoute()).toBe('golf/ledger')
  })

  it('leaves a payment link out of any tenant', () => {
    // The payer has no club of their own to put in front of the token.
    stubLocation('http://localhost/pay/tok_1')

    expect(currentTenantId()).toBeNull()
    expect(currentRoute()).toBe('pay/tok_1')
  })

  it('falls back to the home route', () => {
    stubLocation('http://localhost/tn_1')

    expect(currentTenantId()).toBe('tn_1')
    expect(currentRoute()).toBe('golf')
  })

  it('still reads a query the old hash shape carries', () => {
    stubLocation('http://localhost/cancellation-fees/new#/cancellation-fees/new?orderId=ord_1')

    expect(currentRouteSearchParams().get('orderId')).toBe('ord_1')
  })
})

const ORIGIN = 'http://localhost'

/**
 * The suite runs without a DOM, so the pieces of `window` the router touches are
 * modelled here: a real history stack whose `back()`/`forward()` fire `popstate`
 * the way a browser does, and whose `pushState` drops the entries ahead of it.
 */
function stubBrowser(initialRoute = 'golf') {
  const listeners = new Map<string, Set<(event: { type: string }) => void>>()
  const entries: { href: string; state: unknown }[] = [
    { href: `${ORIGIN}/${initialRoute}`, state: null },
  ]
  let index = 0

  const location = {
    href: entries[0].href,
    protocol: 'http:',
    pathname: `/${initialRoute}`,
    search: '',
    hash: '',
  }

  function resolve(url: string) {
    return new URL(url, location.href).href
  }

  function apply() {
    const entry = entries[index]
    const parsed = new URL(entry.href)
    location.href = parsed.href
    location.pathname = parsed.pathname
    location.search = parsed.search
    location.hash = parsed.hash
    history.state = entry.state
  }

  function emit(type: string, event: { type: string } = { type }) {
    for (const handler of [...(listeners.get(type) ?? [])]) handler(event)
  }

  const history = {
    state: null as unknown,
    pushState(state: unknown, _title: string, url: string) {
      entries.splice(index + 1)
      entries.push({ href: resolve(url), state })
      index = entries.length - 1
      apply()
    },
    replaceState(state: unknown, _title: string, url: string) {
      entries[index] = { href: resolve(url), state }
      apply()
    },
    back() {
      if (index === 0) return
      index -= 1
      apply()
      emit('popstate')
    },
    forward() {
      if (index === entries.length - 1) return
      index += 1
      apply()
      emit('popstate')
    },
  }

  const win = {
    location,
    history,
    addEventListener(type: string, handler: (event: { type: string }) => void) {
      const set = listeners.get(type) ?? new Set<(event: { type: string }) => void>()
      set.add(handler)
      listeners.set(type, set)
    },
    removeEventListener(type: string, handler: (event: { type: string }) => void) {
      listeners.get(type)?.delete(handler)
    },
    dispatchEvent(event: { type: string }) {
      emit(event.type, event)
      return true
    },
    confirm: () => true,
  }

  vi.stubGlobal('window', win)
  return {
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    entryCount: () => entries.length,
    entryIndex: () => index,
  }
}

describe('the tenant in front of the route', () => {
  it('keeps the tenant across a navigation', () => {
    stubBrowser('tn_1/golf')

    navigate('golf/ledger?date=2026-08-12')

    expect(window.location.pathname).toBe('/tn_1/golf/ledger')
    expect(window.location.search).toBe('?date=2026-08-12')
    expect(currentTenantId()).toBe('tn_1')
    expect(currentRoute()).toBe('golf/ledger')
  })

  it('puts the resolved tenant in front of the screen already open', () => {
    stubBrowser('golf/ledger')

    replaceTenantId('tn_1')

    expect(window.location.pathname).toBe('/tn_1/golf/ledger')
  })

  it('takes the operator out of a tenant when they switch clubs', () => {
    stubBrowser('tn_1/golf/ledger')

    replaceTenantId()

    expect(window.location.pathname).toBe('/golf/ledger')
  })
})

describe('a link written for the old shape', () => {
  it('moves the route out of the hash and the tenant into the path', () => {
    // Bookmarks, and the payment links already sent to customers.
    stubBrowser('')
    window.history.replaceState(null, '', '/?tenant=tn_1#/golf/ledger?date=2026-08-12')

    adoptLegacyLocation()

    expect(window.location.pathname).toBe('/tn_1/golf/ledger')
    expect(currentRouteSearchParams().get('date')).toBe('2026-08-12')
    expect(currentRouteSearchParams().get('tenant')).toBeNull()
  })

  it('leaves a payment link tenant-less', () => {
    stubBrowser('')
    window.history.replaceState(null, '', '/#/pay/tok_1')

    adoptLegacyLocation()

    expect(window.location.pathname).toBe('/pay/tok_1')
    expect(currentRoute()).toBe('pay/tok_1')
  })

  it('does nothing to a location already written the new way', () => {
    stubBrowser('tn_1/golf/ledger')

    adoptLegacyLocation()

    expect(window.location.pathname).toBe('/tn_1/golf/ledger')
  })
})

describe('unsaved-input guard', () => {
  it('cancels a navigate() the guard refuses', () => {
    stubBrowser()
    const unregister = registerNavigationGuard(() => false)
    try {
      expect(navigate('golf/caddies')).toBe(false)
      expect(currentRoute()).toBe('golf')
    } finally {
      unregister()
    }
  })

  it('watches the browser exits only while a guard is registered', () => {
    const browser = stubBrowser()
    expect(browser.listenerCount('popstate')).toBe(0)
    expect(browser.listenerCount('beforeunload')).toBe(0)

    const first = registerNavigationGuard(() => true)
    const second = registerNavigationGuard(() => true)
    expect(browser.listenerCount('popstate')).toBe(1)
    expect(browser.listenerCount('beforeunload')).toBe(1)

    first()
    expect(browser.listenerCount('beforeunload')).toBe(1)
    second()
    expect(browser.listenerCount('popstate')).toBe(0)
    expect(browser.listenerCount('beforeunload')).toBe(0)
  })

  it('asks the browser to confirm a reload or a window close', () => {
    stubBrowser()
    const unregister = registerNavigationGuard(() => true)
    try {
      const event = { type: 'beforeunload', returnValue: 'untouched', preventDefault: vi.fn() }
      window.dispatchEvent(event as unknown as Event)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.returnValue).toBe('')
    } finally {
      unregister()
    }
  })

  it('restores the screen when the guard refuses a browser back', () => {
    const browser = stubBrowser()
    navigate('golf/caddies')
    const routeChanges = vi.fn()
    window.addEventListener('courseboard:navigate', routeChanges)

    const unregister = registerNavigationGuard(() => false)
    try {
      window.history.back()

      expect(currentRoute()).toBe('golf/caddies')
      expect(window.location.href).toBe(`${ORIGIN}/golf/caddies`)
      // The restore is a push, not an undo: the entry left behind stays behind,
      // and the pushed one replaces what was ahead of it.
      expect(browser.entryCount()).toBe(2)
      expect(browser.entryIndex()).toBe(1)
      // `pushState` re-enters nothing, so there is no loop and no second prompt.
      expect(routeChanges).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
  })

  it('keeps navigating when the guard accepts a browser back', () => {
    stubBrowser()
    navigate('golf/caddies')
    const unregister = registerNavigationGuard(() => true)
    try {
      window.history.back()
      expect(currentRoute()).toBe('golf')
    } finally {
      unregister()
    }
  })

  it('leaves a restored entry navigable again', () => {
    stubBrowser()
    navigate('golf/caddies')
    let guarded = true
    const unregister = registerNavigationGuard(() => !guarded)
    try {
      window.history.back()
      expect(currentRoute()).toBe('golf/caddies')

      // The operator saves, the screen stops holding anything, and back works.
      guarded = false
      window.history.back()
      expect(currentRoute()).toBe('golf')
    } finally {
      unregister()
    }
  })

  it('asks once when the in-app back button already confirmed', () => {
    stubBrowser()
    navigate('golf/caddies')
    const guard = vi.fn(() => true)
    const unregister = registerNavigationGuard(guard)
    try {
      goBack()
      expect(guard).toHaveBeenCalledTimes(1)
      expect(currentRoute()).toBe('golf')
    } finally {
      unregister()
    }
  })
})
