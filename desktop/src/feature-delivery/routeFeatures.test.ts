import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { EXEMPT_ROUTES, FEATURE_KEYS, ROUTE_FEATURES, routeFeatureKey } from './routeFeatures'

const manifest = readFileSync(
  new URL('../../../.tachyon/manifests/courseboard-product-features.yml', import.meta.url),
  'utf8',
)
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

/** `key → uiRefs` read off the generated manifest. */
function manifestUiRoutes() {
  const routes = new Map<string, string[]>()
  let current = ''
  let inUiRefs = false
  for (const line of manifest.split('\n')) {
    const key = line.match(/^ {2}- key: (\S+)$/)
    if (key) {
      current = key[1]
      routes.set(current, [])
      continue
    }
    if (/^ {4}uiRefs:/.test(line)) {
      inUiRefs = true
      continue
    }
    const ref = line.match(/^ {4}- id: "route:(.+)"$/)
    if (inUiRefs && ref) {
      routes.get(current)?.push(ref[1])
      continue
    }
    if (/^ {4}[^\s-]/.test(line)) inUiRefs = false
  }
  return routes
}

/** Every route literal the router branches on, as a concrete route. */
function appRoutes() {
  const literals = new Set<string>()
  for (const match of appSource.matchAll(/route(?:\.startsWith\(|\s*===\s*)'([^']+)'/g)) {
    const route = match[1]
    literals.add(route.endsWith('/') ? `${route}sample` : route)
  }
  return [...literals]
}

describe('feature catalog on screens', () => {
  it('knows exactly the keys the server catalog declares', () => {
    expect([...FEATURE_KEYS].sort()).toEqual([...manifestUiRoutes().keys()].sort())
  })

  it('maps each screen to the feature whose uiRefs list it', () => {
    const fromManifest = [...manifestUiRoutes()]
      .flatMap(([key, routes]) => routes.map(route => `${route} → ${key}`))
      .sort()
    const fromTable = Object.entries(ROUTE_FEATURES)
      .map(([route, key]) => `${route} → ${key}`)
      .sort()
    expect(fromTable).toEqual(fromManifest)
  })

  it('gives every screen the router knows a feature or an exemption', () => {
    const routes = appRoutes()
    expect(routes.length).toBeGreaterThan(30)
    const keyless = routes.filter(route => routeFeatureKey(route) === undefined)
    expect(keyless, 'add these screens to ROUTE_FEATURES (and the catalog) or EXEMPT_ROUTES').toEqual([])
  })

  it('prefers literal screens over parameterised ones', () => {
    expect(routeFeatureKey('golf/customers/reception')).toBe('courseboard.customers.reception')
    expect(routeFeatureKey('golf/customers/cus_1')).toBe('courseboard.customers')
    expect(routeFeatureKey('golf/caddies/payroll')).toBe('courseboard.caddies.payroll')
    expect(routeFeatureKey('golf/caddies/cad_1')).toBe('courseboard.caddies')
    expect(routeFeatureKey('cancellation-fees/new')).toBe('courseboard.cancellation_fee')
    expect(routeFeatureKey('golf/reservation-products/svc_1')).toBe('courseboard.products')
  })

  it('leaves hubs, member administration, and public pages ungated', () => {
    for (const route of ['golf', 'settings', 'settings/members', 'download', 'pay/token123']) {
      expect(routeFeatureKey(route), route).toBeNull()
    }
    expect(EXEMPT_ROUTES.has('pay/:token')).toBe(true)
  })
})
