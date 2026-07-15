import { useEffect, useState } from 'react'

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
  window.location.hash = `#/${normalized}`
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute)
  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return route
}
