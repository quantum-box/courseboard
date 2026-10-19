import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { routeActionRequirement } from '../auth/capabilityRoutes'
import {
  ACTION_FEATURES,
  EXEMPT_ROUTES,
  FEATURE_KEYS,
  ROUTE_FEATURES,
  routeFeatureKey,
  routeFeatureKeys,
} from './routeFeatures'

const manifest = readFileSync(
  new URL('../../../.tachyon/manifests/courseboard-product-features.yml', import.meta.url),
  'utf8',
)
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

/** The feature keys the generated manifest declares. */
function manifestKeys() {
  return [...manifest.matchAll(/^ {2}- key: (\S+)$/gm)].map(match => match[1])
}

/** `key → requiredActions` (the feature-level list) off the manifest. */
function manifestActions() {
  const actions = new Map<string, string[]>()
  let current = ''
  let inActions = false
  for (const line of manifest.split('\n')) {
    const key = line.match(/^ {2}- key: (\S+)$/)
    if (key) {
      current = key[1]
      actions.set(current, [])
      continue
    }
    if (/^ {4}requiredActions:/.test(line)) {
      inActions = true
      continue
    }
    const action = line.match(/^ {4}- "(.+)"$/)
    if (inActions && action) {
      actions.get(current)?.push(action[1])
      continue
    }
    if (/^ {4}[^\s-]/.test(line)) inActions = false
  }
  return actions
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
    expect([...FEATURE_KEYS].sort()).toEqual(manifestKeys().sort())
  })

  it('reaches every catalog key from some screen', () => {
    const reached = new Set<string>([
      ...Object.values(ROUTE_FEATURES),
      ...Object.values(ACTION_FEATURES),
      // Gated as controls inside another feature's screen.
      'courseboard.tee_sheet.checkin',
      'courseboard.caddies.availability',
    ])
    expect(FEATURE_KEYS.filter(key => !reached.has(key))).toEqual([])
  })

  it('gives every screen the router knows a feature or an exemption', () => {
    const routes = appRoutes()
    expect(routes.length).toBeGreaterThan(30)
    const keyless = routes.filter(route => routeFeatureKey(route) === undefined)
    expect(keyless, 'add these screens to ROUTE_FEATURES (and the catalog) or EXEMPT_ROUTES').toEqual([])
  })

  it('maps every action a gated screen must hold to a feature that declares it', () => {
    const actions = manifestActions()
    const unmapped = new Set<string>()
    for (const route of Object.keys(ROUTE_FEATURES)) {
      for (const action of routeActionRequirement(route)?.allOf ?? []) {
        if (!ACTION_FEATURES[action]) unmapped.add(action)
      }
    }
    expect([...unmapped], 'add these to ACTION_FEATURES').toEqual([])
    for (const [action, key] of Object.entries(ACTION_FEATURES)) {
      expect(actions.get(key), `${action} → ${key}`).toContain(action)
    }
  })

  it('gates a composite screen on every feature it loads', () => {
    expect(routeFeatureKeys('golf/caddies/shifts')).toEqual(expect.arrayContaining([
      'courseboard.caddies.shifts',
      'courseboard.caddies.dispatch',
      'courseboard.courses',
    ]))
    expect(routeFeatureKeys('golf/caddies/cad_1')).toEqual(expect.arrayContaining([
      'courseboard.caddies',
      'courseboard.courses',
    ]))
    expect(routeFeatureKeys('golf/data-imports/courseboardReservationReports/documents/dtj_1'))
      .toEqual(expect.arrayContaining([
        'courseboard.reservation_report_import',
        'courseboard.data_imports',
      ]))
    expect(routeFeatureKeys('staff')).toEqual(['courseboard.staff'])
    expect(routeFeatureKeys('staff/stf_1')).toEqual(['courseboard.staff'])
    expect(routeFeatureKeys('golf')).toBeNull()
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
