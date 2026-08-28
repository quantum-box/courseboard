import { isDesktopWindowTabOpenClick } from '@tachyon-sdk/native-ui'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

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

/**
 * A location reads `{base}/{tenantId}/{route}?{query}`.
 *
 * The tenant is a path segment rather than a query parameter because it is not
 * a filter on a screen: it says which club's board the rest of the URL is
 * about, and everything under it — every route, every id in it — only means
 * anything inside that tenant.
 *
 * Tauri and any `file://` build keep the same shape inside the hash. Their
 * webview loads `index.html` off disk, so a deep path is a file that is not
 * there: a reload or a second tab would 404 rather than open the board.
 */
function usesHashLocation() {
  return isTauri() || window.location.protocol === 'file:'
}

/** Where the SPA is mounted (`/` on Workers, `/ui/` behind axum). */
export function basePath() {
  const base = import.meta.env.BASE_URL
  if (!base || !base.startsWith('/')) return '/'
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Route roots, so the first segment can be told apart from a tenant id.
 *
 * A link is allowed to leave the tenant off — `/golf/ledger` opens the tenant
 * the operator last used — and something has to decide which of the two a
 * leading `golf` is. Keep in step with the routes `App` renders.
 */
const ROUTE_ROOTS = new Set([
  'golf',
  'staff',
  'settings',
  'cancellation-fees',
  'course-map',
  'pay',
  'download',
])

/** The whole path, tenant included, with no leading or trailing slash. */
function currentLocationPath() {
  if (usesHashLocation()) {
    return trimSlashes(window.location.hash.replace(/^#/, '').split('?', 1)[0] ?? '')
  }
  const path = window.location.pathname
  const base = basePath()
  const relative = path.startsWith(base) ? path.slice(base.length) : path
  return trimSlashes(relative)
}

function trimSlashes(value: string) {
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

function splitLocation(path: string) {
  const segments = trimSlashes(path).split('/').filter(Boolean)
  const first = segments[0]
  // `pay` and `download` are the same page for everyone, and a customer opening
  // a payment link has no tenant of their own to put in front of it.
  if (!first || ROUTE_ROOTS.has(first)) return { tenantId: null, route: segments.join('/') }
  return { tenantId: decodeRouteSegment(first), route: segments.slice(1).join('/') }
}

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The tenant the URL names, or null while the app has yet to resolve one. */
export function currentTenantId(): string | null {
  return splitLocation(currentLocationPath()).tenantId
}

export function currentRoute() {
  return splitLocation(currentLocationPath()).route || 'golf'
}

export function currentRouteSearchParams() {
  const params = new URLSearchParams(window.location.search)
  // Links issued before the route moved out of the hash carry their query
  // there; the hash wins because it is the one written next to the route.
  const queryIndex = window.location.hash.indexOf('?')
  if (queryIndex >= 0) {
    const hashParams = new URLSearchParams(window.location.hash.slice(queryIndex + 1))
    hashParams.forEach((value, key) => params.set(key, value))
  }
  return params
}

/** The query as the current location writes it, with no legacy merging. */
function currentWrittenSearchParams() {
  if (!usesHashLocation()) return new URLSearchParams(window.location.search)
  const queryIndex = window.location.hash.indexOf('?')
  return new URLSearchParams(queryIndex >= 0 ? window.location.hash.slice(queryIndex + 1) : '')
}

/** A whole URL for a route, so links can be built without navigating. */
export function routeHref(route: string, query?: URLSearchParams | string) {
  const tenantId = currentTenantId()
  const path = [tenantId ? encodeURIComponent(tenantId) : null, trimSlashes(route)]
    .filter(Boolean)
    .join('/')
  const search = query?.toString() ?? ''
  const suffix = `${path}${search ? `?${search}` : ''}`
  return usesHashLocation() ? `#/${suffix}` : `${basePath()}${suffix}`
}

/**
 * Rewrites the query the current route carries. An empty or null value drops
 * the parameter.
 *
 * A `replaceState`, not a push: changing a filter is the same screen looking
 * somewhere else, so back keeps meaning "the screen before this one" instead of
 * turning into a date stepper the operator has to click through.
 */
export function replaceRouteSearchParams(updates: Record<string, string | null | undefined>) {
  const params = currentWrittenSearchParams()
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') params.delete(key)
    else params.set(key, value)
  }
  const next = routeHref(currentRoute(), params)
  if (currentHref() === next) return
  window.history.replaceState(historyStateRecord(), '', next)
  if (unsavedListenersAttached) rememberLocation()
  // `replaceState` notifies nobody, so the screens reading the query would keep
  // showing what it said before.
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/** What `routeHref` would return for where the app is now. */
function currentHref() {
  return usesHashLocation()
    ? window.location.hash
    : `${window.location.pathname}${window.location.search}`
}

/**
 * Puts a tenant in front of the route the app is already showing.
 *
 * A replace, not a push: the tenant was always the one the app resolved — the
 * URL just did not say so yet — and back should leave the screen rather than
 * step through the same screen without its tenant.
 */
export function replaceTenantId(tenantId?: string) {
  const path = [tenantId ? encodeURIComponent(tenantId) : null, currentRoute()]
    .filter(Boolean)
    .join('/')
  const params = currentWrittenSearchParams()
  // Only ever set by the pre-tenant URL shape, and now said by the path.
  params.delete('tenant')
  const search = params.toString()
  const suffix = `${path}${search ? `?${search}` : ''}`
  const next = usesHashLocation() ? `#/${suffix}` : `${basePath()}${suffix}`
  if (currentHref() === next) return
  window.history.replaceState(historyStateRecord(), '', next)
  if (unsavedListenersAttached) rememberLocation()
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/**
 * Moves a link written for the old shape onto the current one, once, at boot.
 *
 * `#/golf/ledger` was the whole app until the tenant moved into the path, and
 * `?tenant=` was where the tenant lived. Both are still in circulation —
 * bookmarks, and the payment links already sent to customers — so they are
 * translated rather than 404'd.
 */
export function adoptLegacyLocation() {
  if (usesHashLocation()) return
  const hash = window.location.hash
  const legacyRoute = hash.startsWith('#/') ? hash.slice(2) : ''
  const search = new URLSearchParams(window.location.search)
  const legacyTenant = search.get('tenant')
  if (!legacyRoute && !legacyTenant) return

  const [routePart, queryPart] = legacyRoute.split('?', 2)
  const params = new URLSearchParams(queryPart ?? '')
  search.forEach((value, key) => {
    if (key !== 'tenant' && !params.has(key)) params.set(key, value)
  })
  const route = trimSlashes(routePart ?? '') || currentRoute()
  const { tenantId: routeTenant, route: bareRoute } = splitLocation(route)
  const tenantId = routeTenant ?? legacyTenant ?? currentTenantId()
  const path = [tenantId ? encodeURIComponent(tenantId) : null, bareRoute]
    .filter(Boolean)
    .join('/')
  const query = params.toString()
  window.history.replaceState(
    historyStateRecord(),
    '',
    `${basePath()}${path}${query ? `?${query}` : ''}`,
  )
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

/**
 * False when a guard cancelled the navigation, so callers can stay put.
 *
 * `route` may carry its own query (`golf/caddies/attendance?date=…`) for the
 * moves that have to keep what the screen is showing; the tenant is never
 * written by the caller — it is where the app already is.
 */
export function navigate(route: string) {
  const normalized = route.replace(/^#?\/?/, '')
  const [path, query] = normalized.split('?', 2)
  const next = routeHref(path ?? '', query)
  if (currentHref() === next) return true
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
    next,
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
  const tenantId = currentTenantId()
  const suffix = [tenantId ? encodeURIComponent(tenantId) : null, route.replace(/^#?\/?/, '')]
    .filter(Boolean)
    .join('/')
  // A new webview loads the bundled file, so the route rides in the hash even
  // when the running window is showing it as a path.
  invoke('create_courseboard_tab', {
    path: `index.html#/${suffix}`,
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

/**
 * A filter the screen keeps in the URL rather than in itself.
 *
 * What the desk is looking at is a day, not a screen: a link that carries no
 * date reopens on today, which is the wrong day for everyone it was sent to,
 * and a reload throws away the day somebody had paged to. Keeping the value in
 * the query makes reload, a second window and a pasted link show the same
 * board.
 *
 * `fallback` is read once, the way a `useState` initializer is: the tenant
 * timezone can arrive after the first render, and a "today" that moves
 * underneath the operator would take the board with it.
 *
 * `normalize` rejects what nobody typed on purpose — a truncated link, a
 * hand-edited URL — and the screen falls back rather than asking Field for a
 * day that does not exist.
 */
export function useRouteParamState(
  key: string,
  {
    fallback,
    normalize = value => value.trim() || null,
  }: {
    fallback: string
    normalize?: (raw: string) => string | null
  },
): [string, Dispatch<SetStateAction<string>>] {
  const fallbackRef = useRef(fallback)
  const normalizeRef = useRef(normalize)
  normalizeRef.current = normalize

  /** Null when the URL says nothing this screen can show. */
  const readParam = useCallback(() => {
    const raw = currentRouteSearchParams().get(key)
    return raw === null ? null : normalizeRef.current(raw)
  }, [key])

  const [value, setValue] = useState(() => readParam() ?? fallbackRef.current)

  useEffect(() => {
    replaceRouteSearchParams({ [key]: value })
  }, [key, value])

  // Back, forward and a pasted URL all change the query without going through
  // the setter, so the screen follows the URL as well as writing to it.
  useEffect(() => {
    // A route the screen survives — one screen's tabs — has to carry the value
    // with it: `navigate` builds the hash from the route alone, so a bare route
    // reads here as "no day named" and the screen falls back to today. Those
    // call sites pass it on the route: `golf/caddies/attendance?date=…`.
    const onRouteChange = () => setValue(readParam() ?? fallbackRef.current)
    window.addEventListener('hashchange', onRouteChange)
    window.addEventListener('popstate', onRouteChange)
    window.addEventListener(NAVIGATE_EVENT, onRouteChange)
    return () => {
      window.removeEventListener('hashchange', onRouteChange)
      window.removeEventListener('popstate', onRouteChange)
      window.removeEventListener(NAVIGATE_EVENT, onRouteChange)
    }
  }, [key, readParam])

  return [value, setValue]
}
