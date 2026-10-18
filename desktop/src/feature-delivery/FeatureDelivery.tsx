import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { useAuth } from '../auth/AuthProvider'
import {
  type DeliveryEnforcement,
  type FeatureDeliveryValue,
  evaluateFeatureDeliveries,
} from './feature-delivery-api'
import { FEATURE_KEYS, routeFeatureKeys } from './routeFeatures'

/**
 * Whether the tenant's plan provides each CourseBoard feature.
 *
 * The decision is the server's: it asks Tachyon Core's `featureDeliveryValues`
 * (contract ∧ release flag) and ANDs each feature's requirements. This
 * provider only carries the answer to the screens, so the UI never computes a
 * second entitlement of its own.
 *
 * Unlike a release flag, an unknown answer is not "show it": with enforcement
 * on, a screen whose feature could not be confirmed stays behind the loader
 * with a retry, and its links stay out of the navigation (PLT-5229).
 */
export type FeatureDeliveryContextValue = Readonly<{
  enforcement: DeliveryEnforcement | null
  values: Readonly<Record<string, FeatureDeliveryValue>>
  error: boolean
  isLoading: boolean
  refresh: () => void
}>

const FeatureDeliveryContext = createContext<FeatureDeliveryContextValue | null>(null)

const REFRESH_INTERVAL_MS = 60_000
const EMPTY: Readonly<Record<string, FeatureDeliveryValue>> = Object.freeze({})

type State = Omit<FeatureDeliveryContextValue, 'refresh'> & { tenantId: string }

export function FeatureDeliveryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { tenant } = useAuth()
  const tenantId = tenant?.id ?? ''
  const [refreshKey, setRefreshKey] = useState(0)
  const [state, setState] = useState<State>({
    tenantId: '', enforcement: null, values: EMPTY, error: false, isLoading: true,
  })
  const refresh = useCallback(() => setRefreshKey(value => value + 1), [])

  useEffect(() => {
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  useEffect(() => {
    const controller = new AbortController()
    if (!tenantId) {
      setState({ tenantId, enforcement: null, values: EMPTY, error: false, isLoading: false })
      return () => controller.abort()
    }
    // A background refresh keeps the last answer for the same tenant, so a
    // focused form is not unmounted; a tenant switch drops it at once.
    setState(current => current.tenantId === tenantId
      ? current
      : { tenantId, enforcement: null, values: EMPTY, error: false, isLoading: true })
    void evaluateFeatureDeliveries(FEATURE_KEYS, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setState({ tenantId, ...result, error: false, isLoading: false })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState(current => ({
          tenantId,
          enforcement: current.tenantId === tenantId ? current.enforcement : null,
          values: current.tenantId === tenantId ? current.values : EMPTY,
          error: true,
          isLoading: false,
        }))
      })
    return () => controller.abort()
  }, [refreshKey, tenantId])

  const value = useMemo<FeatureDeliveryContextValue>(() => {
    const current = state.tenantId === tenantId
    return {
      enforcement: current ? state.enforcement : null,
      values: current ? state.values : EMPTY,
      error: current && state.error,
      isLoading: !current || state.isLoading,
      refresh,
    }
  }, [refresh, state, tenantId])
  return <FeatureDeliveryContext.Provider value={value}>{children}</FeatureDeliveryContext.Provider>
}

export function MockFeatureDeliveryProvider({
  children,
  enforcement = 'enforce',
  provided,
}: Readonly<{
  children: ReactNode
  enforcement?: DeliveryEnforcement
  provided: readonly string[]
}>) {
  const value = useMemo<FeatureDeliveryContextValue>(() => ({
    enforcement,
    values: Object.fromEntries(FEATURE_KEYS.map(key => [key, {
      key, enabled: provided.includes(key), resolved: true,
    }])),
    error: false,
    isLoading: false,
    refresh: () => undefined,
  }), [enforcement, provided])
  return <FeatureDeliveryContext.Provider value={value}>{children}</FeatureDeliveryContext.Provider>
}

/**
 * `true` provided (or not gated), `false` not provided, `null` not known yet.
 *
 * Without a provider (the expired-session shell) nothing is gated: the server
 * still refuses whatever the plan leaves out.
 */
export function deliveryDecision(
  key: string | null | undefined,
  context: Omit<FeatureDeliveryContextValue, 'refresh'> | null,
): boolean | null {
  if (!key || !context) return true
  if (context.enforcement === 'off' || context.enforcement === 'shadow') return true
  if (context.enforcement === null) return context.isLoading || context.error ? null : true
  const value = context.values[key]
  if (!value || !value.resolved) return null
  return value.enabled
}

/** All of a route's features: `false` if any is refused, `null` if any is unknown. */
export function routeDeliveryDecision(
  route: string,
  context: Omit<FeatureDeliveryContextValue, 'refresh'> | null,
): boolean | null {
  const keys = routeFeatureKeys(route)
  if (!keys) return true
  const decisions = keys.map(key => deliveryDecision(key, context))
  if (decisions.includes(false)) return false
  if (decisions.includes(null)) return null
  return true
}

export function useOptionalFeatureDelivery() {
  return useContext(FeatureDeliveryContext)
}

export function useRouteDelivery(route: string) {
  const context = useOptionalFeatureDelivery()
  return {
    decision: routeDeliveryDecision(route, context),
    error: context?.error ?? false,
    refresh: context?.refresh ?? (() => undefined),
  }
}
