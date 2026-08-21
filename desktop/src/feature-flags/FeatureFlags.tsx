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
import { evaluateFeatureFlags, resolveFeatureFlagValues } from './feature-flags-api'

export const FEATURE_FLAG_KEYS = Object.freeze({
  evaluationSmoke: 'feature.courseboard.flag-evaluation-smoke',
  reservationReportImport: 'feature.courseboard.reservation-report-import',
})

const FEATURE_FLAG_REFRESH_INTERVAL_MS = 60_000
const ALL_FEATURE_FLAG_KEYS = Object.freeze(Object.values(FEATURE_FLAG_KEYS))

export type FeatureFlagContextValue = Readonly<{
  error: boolean
  flags: Readonly<Record<string, boolean>>
  isLoading: boolean
  refresh: () => void
}>

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null)

export function FeatureFlagProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { tenant } = useAuth()
  const tenantId = tenant?.id ?? ''
  const [refreshKey, setRefreshKey] = useState(0)
  const [state, setState] = useState<Omit<FeatureFlagContextValue, 'refresh'>>({
    error: false,
    flags: resolveFeatureFlagValues(ALL_FEATURE_FLAG_KEYS, undefined),
    isLoading: true,
  })
  const refresh = useCallback(() => setRefreshKey(value => value + 1), [])

  useEffect(() => {
    const interval = window.setInterval(refresh, FEATURE_FLAG_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  useEffect(() => {
    const controller = new AbortController()
    if (!tenantId) {
      setState({
        error: false,
        flags: resolveFeatureFlagValues(ALL_FEATURE_FLAG_KEYS, undefined),
        isLoading: false,
      })
      return () => controller.abort()
    }

    setState(current => ({ ...current, error: false, isLoading: true }))
    void evaluateFeatureFlags(ALL_FEATURE_FLAG_KEYS, controller.signal)
      .then(flags => {
        if (controller.signal.aborted) return
        setState({ error: false, flags, isLoading: false })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState({
          error: true,
          flags: resolveFeatureFlagValues(ALL_FEATURE_FLAG_KEYS, undefined),
          isLoading: false,
        })
      })
    return () => controller.abort()
  }, [refreshKey, tenantId])

  const value = useMemo<FeatureFlagContextValue>(
    () => ({ ...state, refresh }),
    [refresh, state],
  )
  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  )
}

export function MockFeatureFlagProvider({
  children,
  flags,
}: Readonly<{
  children: ReactNode
  flags: Readonly<Record<string, boolean>>
}>) {
  const value = useMemo<FeatureFlagContextValue>(
    () => ({ error: false, flags, isLoading: false, refresh: () => undefined }),
    [flags],
  )
  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  )
}

export function useFeatureFlag(key: string) {
  const context = useContext(FeatureFlagContext)
  if (!context) {
    throw new Error('useFeatureFlag must be used within FeatureFlagProvider')
  }
  return {
    enabled: context.flags[key] ?? false,
    error: context.error,
    isLoading: context.isLoading,
  }
}
