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

export type CapabilityCoverage = 'complete' | 'partial'

export type OtherBusinessCapabilities = {
  /** Aggregate of all non-document, non-cancellation CourseBoard actions. */
  hasAny: boolean
  reservations: boolean
  hrm: boolean
  customers: boolean
  memberships: boolean
  usage: boolean
}

export type EffectiveCapabilities = {
  capabilityCoverage: CapabilityCoverage
  otherBusiness: OtherBusinessCapabilities
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
  data: EffectiveCapabilities | null
  error: Error | null
  loading: boolean
}

const EMPTY_CAPABILITIES: EffectiveCapabilities = {
  capabilityCoverage: 'partial',
  otherBusiness: {
    hasAny: false,
    reservations: false,
    hrm: false,
    customers: false,
    memberships: false,
    usage: false,
  },
  agentDocuments: {
    invoices: { list: false, send: false },
    quotations: { list: false, send: false },
  },
  cancellationFees: { list: false, manage: false },
}

const EffectiveCapabilitiesContext = createContext<CapabilitiesState>({
  tenantId: '',
  data: null,
  error: null,
  loading: true,
})

function boolean(value: unknown) {
  return value === true
}

function normalizeCapabilities(raw: Partial<EffectiveCapabilities> | null | undefined): EffectiveCapabilities {
  return {
    capabilityCoverage: raw?.capabilityCoverage === 'complete' ? 'complete' : 'partial',
    otherBusiness: {
      hasAny: boolean(raw?.otherBusiness?.hasAny),
      reservations: boolean(raw?.otherBusiness?.reservations),
      hrm: boolean(raw?.otherBusiness?.hrm),
      customers: boolean(raw?.otherBusiness?.customers),
      memberships: boolean(raw?.otherBusiness?.memberships),
      usage: boolean(raw?.otherBusiness?.usage),
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
  // Only a complete snapshot can establish that every other product is
  // absent. Partial or legacy responses leave startup on the requested route
  // until the downstream product guard has its own complete information.
  if (capabilities.capabilityCoverage !== 'complete') return null
  const hasCancellationFees = capabilities.cancellationFees.list || capabilities.cancellationFees.manage
  const hasDocumentProduct = Object.values(capabilities.agentDocuments).some(document =>
    document.list || document.send)
  const hasOtherBusinessProduct = Object.values(capabilities.otherBusiness).some(Boolean)
  const hasOtherProduct = hasDocumentProduct || hasOtherBusinessProduct
  if (!hasCancellationFees || hasOtherProduct) return null
  if (route === 'cancellation-fees' || route.startsWith('cancellation-fees/')) return null
  return 'cancellation-fees'
}

/**
 * Resolves Field's effective actions once per selected tenant. Downstream
 * route guards consume this snapshot; fetching it here keeps the decision
 * independent from reservation and extension startup requests.
 */
export function EffectiveCapabilitiesProvider({ children }: { children: ReactNode }) {
  const { tenant } = useAuth()
  const route = useRoute()
  const tenantId = tenant?.id ?? ''
  const [state, setState] = useState<CapabilitiesState>({
    tenantId: '',
    data: null,
    error: null,
    loading: true,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    if (!tenantId) {
      setState({ tenantId: '', data: null, error: null, loading: false })
      return () => controller.abort()
    }

    setState({ tenantId, data: null, error: null, loading: true })
    void courseboardApiJson<Partial<EffectiveCapabilities>>('/v1/field/client-capabilities', {
      signal: controller.signal,
    })
      .then(raw => {
        if (!controller.signal.aborted) {
          setState({ tenantId, data: normalizeCapabilities(raw), error: null, loading: false })
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setState({
            tenantId,
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false,
          })
        }
      })
    return () => controller.abort()
  }, [attempt, tenantId])

  const snapshotReady = state.tenantId === tenantId && !state.loading && Boolean(state.data)
  const startupTarget = snapshotReady && state.data
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
  const currentError = state.tenantId === tenantId ? state.error : null
  const waitingForSnapshot = !tenantId || state.tenantId !== tenantId || state.loading || Boolean(startupTarget)
  const gate = currentError
    ? <ResourceError error={currentError} onRetry={() => setAttempt(value => value + 1)} />
    : waitingForSnapshot
      ? <LoadingState />
      : !state.data
        ? <ResourceError error={new Error('Capability snapshot is unavailable')} onRetry={() => setAttempt(value => value + 1)} />
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
