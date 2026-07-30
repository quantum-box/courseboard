import { isDesktopWindowTabOpenClick } from '@tachyon-sdk/native-ui'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'

const NAVIGATE_EVENT = 'courseboard:navigate'
const NAVIGATION_STATE_KEY = '__courseboardNavigation'

interface NavigationEntryState {
  index: number
  maxIndex: number
}

export interface NavigationAvailability {
  canGoBack: boolean
  canGoForward: boolean
}

export interface NavigationClickEvent {
  metaKey: boolean
  ctrlKey: boolean
  button: number
  preventDefault: () => void
}

function historyStateRecord(): Record<string, unknown> {
  const state = window.history.state
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {}
}

function currentNavigationEntry(): NavigationEntryState {
  const state = historyStateRecord()[NAVIGATION_STATE_KEY]
  if (
    state
    && typeof state === 'object'
    && 'index' in state
    && 'maxIndex' in state
    && typeof state.index === 'number'
    && typeof state.maxIndex === 'number'
  ) {
    return { index: state.index, maxIndex: state.maxIndex }
  }

  const initial = { index: 0, maxIndex: 0 }
  window.history.replaceState(
    { ...historyStateRecord(), [NAVIGATION_STATE_KEY]: initial },
    '',
    window.location.href,
  )
  return initial
}

export function currentRoute() {
  const hashPath = window.location.hash.replace(/^#\/?/, '').split('?', 1)[0] ?? ''
  const value = hashPath.replace(/\/+$/, '')
  return value || 'golf'
}

export function currentRouteSearchParams() {
  const params = new URLSearchParams(window.location.search)
  const queryIndex = window.location.hash.indexOf('?')
  if (queryIndex >= 0) {
    const hashParams = new URLSearchParams(window.location.hash.slice(queryIndex + 1))
    hashParams.forEach((value, key) => params.set(key, value))
  }
  return params
}

type NavigationGuard = () => boolean

const navigationGuards = new Set<NavigationGuard>()

/**
 * Registers a confirmation step for the screen that is mounted right now. The
 * guard returns `false` to cancel the navigation, which is how a screen holding
 * unsaved input stops the sidebar, ⌘K, the back/forward buttons and its own
 * "back to the list" button from throwing that input away. Returns the
 * unregister callback.
 */
export function registerNavigationGuard(guard: NavigationGuard) {
  navigationGuards.add(guard)
  return () => {
    navigationGuards.delete(guard)
  }
}

/** True when every registered screen agrees it is safe to leave. */
export function confirmNavigation() {
  for (const guard of [...navigationGuards]) {
    if (!guard()) return false
  }
  return true
}

/**
 * Keeps `guard` registered for as long as it is non-null. Pass `null` once the
 * screen has nothing left to lose so navigation stops asking.
 */
export function useNavigationGuard(guard: NavigationGuard | null | undefined) {
  const guardRef = useRef(guard)
  guardRef.current = guard
  const enabled = Boolean(guard)

  useEffect(() => {
    if (!enabled) return
    return registerNavigationGuard(() => guardRef.current?.() ?? true)
  }, [enabled])
}

/** False when a guard cancelled the navigation, so callers can stay put. */
export function navigate(route: string) {
  const normalized = route.replace(/^#?\/?/, '')
  const nextHash = `#/${normalized}`
  if (window.location.hash === nextHash) return true
  if (!confirmNavigation()) return false

  const current = currentNavigationEntry()
  const nextIndex = current.index + 1
  window.history.replaceState(
    {
      ...historyStateRecord(),
      [NAVIGATION_STATE_KEY]: { index: current.index, maxIndex: nextIndex },
    },
    '',
    window.location.href,
  )
  window.history.pushState(
    { [NAVIGATION_STATE_KEY]: { index: nextIndex, maxIndex: nextIndex } },
    '',
    nextHash,
  )
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
  return true
}

export function navigateFromClick(event: NavigationClickEvent, route: string) {
  const opensNewTab = isDesktopWindowTabOpenClick(event) && isTauri()
  if (!opensNewTab) {
    navigate(route)
    return
  }

  event.preventDefault()
  const normalized = route.replace(/^#?\/?/, '')
  invoke('create_courseboard_tab', {
    path: `index.html#/${normalized}`,
    activate: false,
  }).catch(console.error)
}

export function navigationAvailability(): NavigationAvailability {
  const { index, maxIndex } = currentNavigationEntry()
  return { canGoBack: index > 0, canGoForward: index < maxIndex }
}

export function goBack() {
  if (!navigationAvailability().canGoBack) return
  if (!confirmNavigation()) return
  window.history.back()
}

export function goForward() {
  if (!navigationAvailability().canGoForward) return
  if (!confirmNavigation()) return
  window.history.forward()
}

export function useNavigationAvailability(): NavigationAvailability {
  const [availability, setAvailability] = useState(navigationAvailability)
  useEffect(() => {
    const onChange = () => setAvailability(navigationAvailability())
    window.addEventListener('popstate', onChange)
    window.addEventListener(NAVIGATE_EVENT, onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(NAVIGATE_EVENT, onChange)
    }
  }, [])
  return availability
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute)
  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('popstate', onHashChange)
    window.addEventListener(NAVIGATE_EVENT, onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('popstate', onHashChange)
      window.removeEventListener(NAVIGATE_EVENT, onHashChange)
    }
  }, [])
  return route
}
