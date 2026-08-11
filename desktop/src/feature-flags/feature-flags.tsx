import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { evaluateFeatureFlags, resolveFeatureFlagValues } from './feature-flags-api'

/**
 * Every CourseBoard flag the SPA evaluates. Keys must be declared in the
 * `courseboard-flags` manifest in `tachyon.yaml`; evaluation is fail-closed,
 * so an undeclared key silently stays disabled. Keys missing from this record
 * are never fetched and `useFeatureFlag` returns `false` for them.
 */
export const FEATURE_FLAG_KEYS = Object.freeze({
  evaluationSmoke: 'feature.courseboard.flag-evaluation-smoke',
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
    setState(current => ({ ...current, error: false, isLoading: true }))
    void evaluateFeatureFlags(ALL_FEATURE_FLAG_KEYS, controller.signal)
      .then(flags => {
        if (controller.signal.aborted) return
        setState({ error: false, flags, isLoading: false })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        // Fail closed: an unreachable provider disables every flag.
        setState({
          error: true,
          flags: resolveFeatureFlagValues(ALL_FEATURE_FLAG_KEYS, undefined),
          isLoading: false,
        })
      })
    return () => controller.abort()
  }, [refreshKey])

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

export function useFeatureFlags(): FeatureFlagContextValue {
  const context = useContext(FeatureFlagContext)
  if (context === null) {
    throw new Error('useFeatureFlags must be used within a FeatureFlagProvider')
  }
  return context
}

/**
 * Check one flag. Render a loading state while `isLoading` is true to avoid a
 * flash of the disabled branch before the first evaluation lands.
 */
export function useFeatureFlag(key: string): { enabled: boolean; isLoading: boolean } {
  const { flags, isLoading } = useFeatureFlags()
  return { enabled: flags[key] === true, isLoading }
}
