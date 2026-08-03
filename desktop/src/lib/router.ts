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

interface TrackedLocation {
  href: string
  entry: NavigationEntryState
}

/**
 * The entry the app believes it is showing. `popstate` cannot be cancelled, so
 * the only way to keep unsaved input after the browser has already moved is to
 * push the entry the operator was on back on top — which needs its URL.
 */
let trackedLocation: TrackedLocation | null = null
let unsavedListenersAttached = false
/** Set while `goBack`/`goForward` move the history themselves: they ask the
 * guards first, so the `popstate` they cause must not ask a second time. */
let expectingOwnPopState = false

function rememberLocation() {
  trackedLocation = { href: window.location.href, entry: currentNavigationEntry() }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (navigationGuards.size === 0) return
  // Closing the window or reloading never reaches a guard — the app is gone
  // before it could ask. The browser's own prompt is the only thing left.
  event.preventDefault()
  event.returnValue = ''
}

/**
 * The browser's own back button and WebKit's swipe-back fire `popstate`, which
 * is not cancellable: by the time this runs the entry has already changed. So
 * ask the guards afterwards and, when the operator chooses to stay, push the
 * entry they were on back on top. That is a restore rather than an undo — the
 * forward entries the browser dropped on the way here do not come back — but it
 * keeps the unsaved screen on screen, which is the whole point.
 */
function onGuardedPopState() {
  if (expectingOwnPopState) {
    expectingOwnPopState = false
    rememberLocation()
    return
  }

  const previous = trackedLocation
  // `pushState` fires no event of its own, so the restore below cannot come back
  // through here; the only loop possible is the operator pressing back again.
  if (!previous || previous.href === window.location.href) {
    rememberLocation()
    return
  }
  if (confirmNavigation()) {
    rememberLocation()
    return
  }

  // The pushed entry lands one step deeper than whatever the browser left us on,
  // and it drops every entry that was ahead of it, so it is the newest entry
  // there is: index and maxIndex agree.
  const landed = currentNavigationEntry().index
  const restored: NavigationEntryState = { index: landed + 1, maxIndex: landed + 1 }
  window.history.pushState(
    { [NAVIGATION_STATE_KEY]: restored },
    '',
    previous.href,
  )
  trackedLocation = { href: previous.href, entry: restored }
  // `pushState` notifies nobody, so the screens listening for a route change
  // would keep rendering the route the cancelled `popstate` moved them to.
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

function attachUnsavedListeners() {
  if (unsavedListenersAttached) return
  unsavedListenersAttached = true
  expectingOwnPopState = false
  rememberLocation()
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('popstate', onGuardedPopState)
}

function detachUnsavedListeners() {
  if (!unsavedListenersAttached) return
  unsavedListenersAttached = false
  trackedLocation = null
  expectingOwnPopState = false
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('popstate', onGuardedPopState)
}

/**
 * Registers a confirmation step for the screen that is mounted right now. The
 * guard returns `false` to cancel the navigation, which is how a screen holding
 * unsaved input stops the sidebar, ⌘K, the back/forward buttons and its own
 * "back to the list" button from throwing that input away. Returns the
 * unregister callback.
 *
 * While at least one guard is registered the browser's own exits are watched
 * too: `beforeunload` for closing and reloading, `popstate` for the back button
 * and WebKit's swipe-back.
 */
export function registerNavigationGuard(guard: NavigationGuard) {
  navigationGuards.add(guard)
  attachUnsavedListeners()
  return () => {
    navigationGuards.delete(guard)
    if (navigationGuards.size === 0) detachUnsavedListeners()
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
  if (unsavedListenersAttached) rememberLocation()
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
  expectingOwnPopState = unsavedListenersAttached
  window.history.back()
}

export function goForward() {
  if (!navigationAvailability().canGoForward) return
  if (!confirmNavigation()) return
  expectingOwnPopState = unsavedListenersAttached
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
