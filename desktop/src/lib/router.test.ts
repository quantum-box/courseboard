import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentRoute,
  currentRouteSearchParams,
  goBack,
  navigate,
  registerNavigationGuard,
} from './router'

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

const ORIGIN = 'http://localhost/index.html'

/**
 * The suite runs without a DOM, so the pieces of `window` the router touches are
 * modelled here: a real history stack whose `back()`/`forward()` fire `popstate`
 * the way a browser does, and whose `pushState` drops the entries ahead of it.
 */
function stubBrowser(initialRoute = 'golf') {
  const listeners = new Map<string, Set<(event: { type: string }) => void>>()
  const entries: { href: string; state: unknown }[] = [
    { href: `${ORIGIN}#/${initialRoute}`, state: null },
  ]
  let index = 0

  const location = { href: entries[0].href, hash: `#/${initialRoute}`, search: '' }

  function resolve(url: string) {
    return url.startsWith('#') ? `${ORIGIN}${url}` : url
  }

  function apply() {
    const entry = entries[index]
    location.href = entry.href
    const hashAt = entry.href.indexOf('#')
    location.hash = hashAt >= 0 ? entry.href.slice(hashAt) : ''
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

describe('unsaved-input guard', () => {
  it('cancels a navigate() the guard refuses', () => {
    stubBrowser()
    const unregister = registerNavigationGuard(() => false)
    try {
      expect(navigate('caddies')).toBe(false)
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
    navigate('caddies')
    const routeChanges = vi.fn()
    window.addEventListener('courseboard:navigate', routeChanges)

    const unregister = registerNavigationGuard(() => false)
    try {
      window.history.back()

      expect(currentRoute()).toBe('caddies')
      expect(window.location.href).toBe(`${ORIGIN}#/caddies`)
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
    navigate('caddies')
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
    navigate('caddies')
    let guarded = true
    const unregister = registerNavigationGuard(() => !guarded)
    try {
      window.history.back()
      expect(currentRoute()).toBe('caddies')

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
    navigate('caddies')
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
