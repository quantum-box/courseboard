import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { courseboardApiJson } from '../api'
import { LoadingState, ResourceError } from '../components/Page'
import { navigate, useRoute } from '../lib/router'
import { useAuth } from './AuthProvider'
import {
  nonFeeBusinessAccessDecision,
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

const INCOMPLETE_CAPABILITY_SNAPSHOT = new Error('Capability snapshot is unavailable')

/**
 * Resolves Field's effective actions once per selected tenant. Downstream
 * route guards consume this snapshot; fetching it here keeps the decision
 * independent from reservation and extension startup requests.
 */
export function EffectiveCapabilitiesProvider({ children }: { children: ReactNode }) {
  const { tenant, user } = useAuth()
  const route = useRoute()
  const tenantId = tenant?.id ?? ''
  const userId = user?.id ?? ''
  const [state, setState] = useState<CapabilitiesState>({
    tenantId: '',
    userId: '',
    data: null,
    error: null,
    loading: true,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    if (!tenantId || !userId) {
      setState({ tenantId: '', userId: '', data: null, error: null, loading: false })
      return () => controller.abort()
    }

    setState({ tenantId, userId, data: null, error: null, loading: true })
    void courseboardApiJson<unknown>('/v1/field/client-capabilities', {
      signal: controller.signal,
    })
      .then(raw => {
        if (!controller.signal.aborted) {
          setState({ tenantId, userId, data: normalizeCapabilities(raw), error: null, loading: false })
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setState({
            tenantId,
            userId,
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false,
          })
        }
      })
    return () => controller.abort()
  }, [attempt, tenantId, userId])

  const snapshotReady = state.tenantId === tenantId
    && state.userId === userId
    && !state.loading
    && Boolean(state.data)
  const routeSnapshotReady = snapshotReady && state.data
    ? capabilitySnapshotReadyForRoute(route, state.data)
    : false
  const startupTarget = routeSnapshotReady && state.data
    ? startupRouteForCapabilities(route, state.data)
    : null
  useEffect(() => {
    // PLT-5225 owns the first screen for an operator who has only the
    // cancellation-fee product. The general route guard remains downstream:
    // this only prevents a saved/default golf home URL from becoming the
    // startup screen after the capability snapshot is known.
    if (startupTarget) navigate(startupTarget)
  }, [startupTarget])

  const value = useMemo<CapabilitiesState>(() => state, [state])
  const currentError = state.tenantId === tenantId && state.userId === userId ? state.error : null
  const incompleteSnapshot = snapshotReady && state.data && !routeSnapshotReady
  const waitingForSnapshot = !tenantId
    || !userId
    || state.tenantId !== tenantId
    || state.userId !== userId
    || state.loading
    || Boolean(startupTarget)
  const gate = currentError
    ? <ResourceError error={currentError} onRetry={() => setAttempt(value => value + 1)} />
    : incompleteSnapshot
      ? <ResourceError
        error={INCOMPLETE_CAPABILITY_SNAPSHOT}
        onRetry={() => setAttempt(value => value + 1)}
      />
    : waitingForSnapshot
      ? <LoadingState />
      : !state.data
        ? <ResourceError error={INCOMPLETE_CAPABILITY_SNAPSHOT} onRetry={() => setAttempt(value => value + 1)} />
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
