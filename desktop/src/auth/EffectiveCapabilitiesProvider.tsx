import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { courseboardApiJson } from '../api'
import { navigate, useRoute } from '../lib/router'
import { useAuth } from './AuthProvider'

export type DocumentCapabilities = {
  list: boolean
  send: boolean
}

export type EffectiveCapabilities = {
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
  data: EffectiveCapabilities | null
  error: Error | null
  loading: boolean
}

const EMPTY_CAPABILITIES: EffectiveCapabilities = {
  agentDocuments: {
    invoices: { list: false, send: false },
    quotations: { list: false, send: false },
  },
  cancellationFees: { list: false, manage: false },
}

const EffectiveCapabilitiesContext = createContext<CapabilitiesState>({
  data: null,
  error: null,
  loading: true,
})

function boolean(value: unknown) {
  return value === true
}

function normalizeCapabilities(raw: Partial<EffectiveCapabilities> | null | undefined): EffectiveCapabilities {
  return {
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
  const hasCancellationFees = capabilities.cancellationFees.list || capabilities.cancellationFees.manage
  const hasOtherProduct = Object.values(capabilities.agentDocuments).some(document =>
    document.list || document.send)
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
    data: null,
    error: null,
    loading: true,
  })

  useEffect(() => {
    const controller = new AbortController()
    if (!tenantId) {
      setState({ data: null, error: null, loading: false })
      return () => controller.abort()
    }

    setState({ data: null, error: null, loading: true })
    void courseboardApiJson<Partial<EffectiveCapabilities>>('/v1/field/client-capabilities', {
      signal: controller.signal,
    })
      .then(raw => {
        if (!controller.signal.aborted) {
          setState({ data: normalizeCapabilities(raw), error: null, loading: false })
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setState({
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false,
          })
        }
      })
    return () => controller.abort()
  }, [tenantId])

  useEffect(() => {
    // PLT-5225 owns the first screen for an operator who has only the
    // cancellation-fee product. The general route guard remains downstream:
    // this only prevents a saved/default golf home URL from becoming the
    // startup screen after the capability snapshot is known.
    if (state.loading || state.error || !state.data) return
    const target = startupRouteForCapabilities(route, state.data)
    if (target) navigate(target)
  }, [route, state.data, state.error, state.loading])

  const value = useMemo<CapabilitiesState>(() => state, [state])
  return (
    <EffectiveCapabilitiesContext.Provider value={value}>
      {children}
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
