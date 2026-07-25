import { isDesktopWindowTabOpenClick } from '@tachyon-sdk/native-ui'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

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

export function navigate(route: string) {
  const normalized = route.replace(/^#?\/?/, '')
  const nextHash = `#/${normalized}`
  if (window.location.hash === nextHash) return

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
  if (navigationAvailability().canGoBack) window.history.back()
}

export function goForward() {
  if (navigationAvailability().canGoForward) window.history.forward()
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
