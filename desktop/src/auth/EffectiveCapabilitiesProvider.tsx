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

export type DocumentCapabilities = {
  list: boolean
  send: boolean
}

export type NavigationCapabilities = {
  /** null means the Field action batch was incomplete or unavailable. */
  otherBusinessAccess: boolean | null
}

export type EffectiveCapabilities = {
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

function normalizeCapabilities(raw: Partial<EffectiveCapabilities> | null | undefined): EffectiveCapabilities {
  const otherBusinessAccess = raw?.navigation?.otherBusinessAccess
  return {
    navigation: {
      otherBusinessAccess: otherBusinessAccess === true
        ? true
        : otherBusinessAccess === false
          ? false
          : null,
    },
    agentDocuments: {
      invoices: {
        list: boolean(raw?.agentDocuments?.invoices?.list),
        send: boolean(raw?.agentDocuments?.invoices?.send),
      },
      quotations: {
        list: boolean(raw?.agentDocuments?.quotations?.list),
        send: boolean(raw?.agentDocuments?.quotations?.send),
      },
    },
    cancellationFees: {
      list: boolean(raw?.cancellationFees?.list),
      manage: boolean(raw?.cancellationFees?.manage),
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
  // Only an explicit false from Field's complete action batch can establish
  // that every other product is absent. True and unknown keep the requested
  // route so mixed-product callers are never redirected into fee-only UI.
  if (capabilities.navigation.otherBusinessAccess !== false) return null
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
 * The navigation aggregate is optional because Field can return a useful fee
 * decision while a larger action batch is incomplete. Fee deep links can use
 * that known fee decision; every other protected route must wait for the
 * aggregate before mounting its business loaders.
 */
export function capabilitySnapshotReadyForRoute(
  route: string,
  capabilities: EffectiveCapabilities,
) {
  return isCancellationFeeRoute(route) || capabilities.navigation.otherBusinessAccess !== null
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
    void courseboardApiJson<Partial<EffectiveCapabilities>>('/v1/field/client-capabilities', {
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
