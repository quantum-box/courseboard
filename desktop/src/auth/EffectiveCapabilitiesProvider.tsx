import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { courseboardApiJson } from '../api'
import { LoadingState, ResourceError } from '../components/Page'
import { navigate, useRoute } from '../lib/router'
import { useAuth } from './AuthProvider'
import {
  firstSnapshot,
  nextExpiry,
  reduceSnapshot,
  REFRESH_INTERVAL_MS,
  UNAVAILABLE_CAPABILITY_SNAPSHOT,
  type CapabilitySnapshot,
  type CapabilitySnapshotEvent,
} from './capabilitySnapshot'
import {
  nonFeeBusinessAccessDecision,
  routeCapabilityDecision,
  routeCapabilitySnapshotKnown,
} from './capabilityRoutes'

export type CapabilityDecision = boolean | null
export type ActionCapabilities = Record<string, CapabilityDecision>

export type DocumentCapabilities = {
  list: boolean
  send: boolean
}

export type NavigationCapabilities = {
  /** null means the Field action batch was incomplete or unavailable. */
  otherBusinessAccess: boolean | null
}

export type EffectiveCapabilities = {
  /** Server-evaluated canonical action decisions. Missing means unknown. */
  actions: ActionCapabilities
  navigation: NavigationCapabilities
  agentDocuments: {
    invoices: DocumentCapabilities
    quotations: DocumentCapabilities
  }
  cancellationFees: {
    list: boolean
    manage: boolean
  }
}

type CapabilitiesState = {
  tenantId: string
  userId: string
  data: EffectiveCapabilities | null
  error: Error | null
  loading: boolean
}

type ScopedSnapshot = {
  tenantId: string
  userId: string
  snapshot: CapabilitySnapshot
}

const EMPTY_CAPABILITIES: EffectiveCapabilities = {
  actions: {},
  navigation: { otherBusinessAccess: null },
  agentDocuments: {
    invoices: { list: false, send: false },
    quotations: { list: false, send: false },
  },
  cancellationFees: { list: false, manage: false },
}

const EffectiveCapabilitiesContext = createContext<CapabilitiesState>({
  tenantId: '',
  userId: '',
  data: null,
  error: null,
  loading: true,
})

function boolean(value: unknown) {
  return value === true
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function normalizeCapabilities(raw: unknown): EffectiveCapabilities {
  const root = record(raw)
  const navigation = record(root.navigation)
  const agentDocuments = record(root.agentDocuments)
  const invoices = record(agentDocuments.invoices)
  const quotations = record(agentDocuments.quotations)
  const cancellationFees = record(root.cancellationFees)
  const rawActions = record(root.actions)
  const actions: ActionCapabilities = {}
  for (const [action, value] of Object.entries(rawActions)) {
    // A malformed action decision is unknown. It must never become an allow
    // through truthiness or by being silently treated as a completed denial.
    actions[action] = value === true ? true : value === false ? false : null
  }
  const otherBusinessAccess = navigation.otherBusinessAccess
  return {
    actions,
    navigation: {
      otherBusinessAccess: otherBusinessAccess === true
        ? true
        : otherBusinessAccess === false
          ? false
          : null,
    },
    agentDocuments: {
      invoices: {
        list: boolean(invoices.list),
        send: boolean(invoices.send),
      },
      quotations: {
        list: boolean(quotations.list),
        send: boolean(quotations.send),
      },
    },
    cancellationFees: {
      list: boolean(cancellationFees.list),
      manage: boolean(cancellationFees.manage),
    },
  }
}

/**
 * The one startup transition owned by PLT-5225. A user with only the
 * cancellation-fee product should not reopen the old golf home after sign-in;
 * a user with another product, or a deep cancellation-fee link, keeps the
 * route they asked for.
 */
export function startupRouteForCapabilities(
  route: string,
  capabilities: EffectiveCapabilities,
) {
  // Unknown authenticated URLs must reach RouteContent so its NotFound branch
  // can answer them. Fee-only startup redirection applies only to a known
  // operator route; otherwise a saved/default URL would hide a 404 behind the
  // cancellation-fee home.
  if (routeCapabilityDecision(route, capabilities) === undefined) return null
  // Only a complete, explicit denial for every non-fee route can establish
  // that this is a fee-only operator. The legacy navigation aggregate is not
  // authoritative for route access and cannot grant or suppress Golf UI.
  if (nonFeeBusinessAccessDecision(capabilities) !== false) return null
  const canListCancellationFees = capabilities.cancellationFees.list
  const canManageCancellationFees = capabilities.cancellationFees.manage
  if (!canListCancellationFees && !canManageCancellationFees) return null
  if (route === 'cancellation-fees' || route.startsWith('cancellation-fees/')) return null
  // A manage-only operator cannot open the list (it is guarded by the list
  // action), but may open the dedicated create flow. Keep the list as the
  // default whenever it is actually granted so read-only operators retain
  // their permitted entry screen.
  return canListCancellationFees ? 'cancellation-fees' : 'cancellation-fees/new'
}

function isCancellationFeeRoute(route: string) {
  return route === 'cancellation-fees' || route.startsWith('cancellation-fees/')
}

/**
 * A fee deep link can use its dedicated fee decision while the larger action
 * batch is incomplete. Every other protected route waits for the exact action
 * decisions needed by that route and its eager loaders; the aggregate is only
 * used by the startup redirect calculation.
 */
export function capabilitySnapshotReadyForRoute(
  route: string,
  capabilities: EffectiveCapabilities,
) {
  return isCancellationFeeRoute(route) || routeCapabilitySnapshotKnown(route, capabilities)
}

/**
 * Resolves Field's effective actions for the selected tenant and user, and
 * re-reads them every minute, on window focus and when the window becomes
 * visible, so a revoked action closes its screen without a reload. Downstream
 * route guards consume this snapshot; fetching it here keeps the decision
 * independent from reservation and extension startup requests.
 */
export function EffectiveCapabilitiesProvider({ children }: { children: ReactNode }) {
  const { tenant, user } = useAuth()
  const route = useRoute()
  const tenantId = tenant?.id ?? ''
  const userId = user?.id ?? ''
  const [state, setState] = useState<ScopedSnapshot | null>(null)
  const retryRef = useRef(() => {})
  const retry = useCallback(() => retryRef.current(), [])

  useEffect(() => {
    if (!tenantId || !userId) {
      setState(null)
      return
    }

    // Everything below belongs to this tenant and user. Switching either
    // aborts the request in flight, so a late answer for the previous
    // principal is dropped.
    let lastId = 1
    let snapshot = firstSnapshot(lastId, performance.now())
    let inFlight: { id: number; controller: AbortController } | null = null
    let expiryTimer: number | undefined

    const commit = (next: CapabilitySnapshot) => {
      snapshot = next
      // A request the snapshot no longer waits for (replaced, or too old to
      // answer in time) is aborted, so its answer is never applied.
      if (inFlight && inFlight.id !== next.pending?.id) {
        inFlight.controller.abort()
        inFlight = null
      }
      window.clearTimeout(expiryTimer)
      const expiresAt = nextExpiry(next)
      expiryTimer = expiresAt === null
        ? undefined
        : window.setTimeout(
          () => apply({ type: 'elapsed', at: performance.now() }),
          expiresAt - performance.now(),
        )
      setState({ tenantId, userId, snapshot: next })
    }
    const apply = (event: CapabilitySnapshotEvent) => commit(reduceSnapshot(snapshot, event))

    const send = (id: number) => {
      const controller = new AbortController()
      inFlight = { id, controller }
      void courseboardApiJson<unknown>('/v1/field/client-capabilities', {
        signal: controller.signal,
      }).then(
        raw => {
          if (controller.signal.aborted) return
          apply({
            type: 'answered',
            id,
            at: performance.now(),
            capabilities: normalizeCapabilities(raw),
          })
        },
        error => {
          if (controller.signal.aborted) return
          apply({
            type: 'failed',
            id,
            at: performance.now(),
            error: error instanceof Error ? error : new Error(String(error)),
          })
        },
      )
    }
    const request = () => {
      lastId += 1
      apply({ type: 'requested', id: lastId, at: performance.now() })
      send(lastId)
    }
    // A background refresh never replaces a request that can still answer in
    // time, so an answer slower than a period still lands. Only Retry
    // replaces it.
    const refreshInBackground = () => {
      apply({ type: 'elapsed', at: performance.now() })
      if (!snapshot.pending) request()
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshInBackground()
    }

    commit(snapshot)
    send(lastId)
    retryRef.current = request
    const interval = window.setInterval(refreshInBackground, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refreshInBackground)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      inFlight?.controller.abort()
      window.clearTimeout(expiryTimer)
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshInBackground)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      retryRef.current = () => {}
    }
  }, [tenantId, userId])

  const current = state?.tenantId === tenantId && state.userId === userId ? state.snapshot : null
  const capabilities = current?.phase === 'open' ? current.capabilities : null
  const routeSnapshotReady = capabilities
    ? capabilitySnapshotReadyForRoute(route, capabilities)
    : false
  const startupTarget = capabilities && routeSnapshotReady
    ? startupRouteForCapabilities(route, capabilities)
    : null
  useEffect(() => {
    // PLT-5225 owns the first screen for an operator who has only the
    // cancellation-fee product. The general route guard remains downstream:
    // this only prevents a saved/default golf home URL from becoming the
    // startup screen after the capability snapshot is known.
    if (startupTarget) navigate(startupTarget)
  }, [startupTarget])

  const value = useMemo<CapabilitiesState>(() => ({
    tenantId,
    userId,
    data: capabilities,
    error: current?.phase === 'closed' ? current.error : null,
    loading: !current || current.phase === 'loading',
  }), [tenantId, userId, current, capabilities])
  const gate = current?.phase === 'closed'
    ? <ResourceError error={current.error} onRetry={retry} />
    : !capabilities || startupTarget
      ? <LoadingState />
      : !routeSnapshotReady
        ? <ResourceError error={UNAVAILABLE_CAPABILITY_SNAPSHOT} onRetry={retry} />
        : children
  return (
    <EffectiveCapabilitiesContext.Provider value={value}>
      {gate}
    </EffectiveCapabilitiesContext.Provider>
  )
}

export function useEffectiveCapabilities() {
  const state = useContext(EffectiveCapabilitiesContext)
  return {
    ...state,
    capabilities: state.data ?? EMPTY_CAPABILITIES,
  }
}
