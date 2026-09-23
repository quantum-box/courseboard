import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { fieldPlatformId, fieldTenant } from '../api'

const resourceCache = new Map<string, unknown>()
const resourceInflight = new Map<string, Promise<unknown>>()
const MAX_CACHE_ENTRIES = 128
const CACHE_KEY_SEPARATOR = '\u0000'

function scopedCacheKey(key: string) {
  return `${fieldPlatformId()}:${fieldTenant()}${CACHE_KEY_SEPARATOR}${key}`
}

function logicalCacheKey(key: string) {
  const separator = key.indexOf(CACHE_KEY_SEPARATOR)
  return separator < 0 ? key : key.slice(separator + CACHE_KEY_SEPARATOR.length)
}

function cached<T>(key: string | null) {
  if (!key || !resourceCache.has(key)) return undefined
  const value = resourceCache.get(key) as T
  // Reading refreshes recency so dynamic date/detail keys evict the least used
  // page rather than the one the operator just revisited.
  resourceCache.delete(key)
  resourceCache.set(key, value)
  return value
}

function cache(key: string, value: unknown) {
  resourceCache.delete(key)
  resourceCache.set(key, value)
  while (resourceCache.size > MAX_CACHE_ENTRIES) {
    const oldest = resourceCache.keys().next().value as string | undefined
    if (!oldest) break
    resourceCache.delete(oldest)
  }
}

/**
 * Share a request only when its fully scoped cache key is the same. A cache
 * entry is written when the consumer's request generation accepts the result;
 * this map only prevents concurrent consumers from starting the same loader.
 */
function loadWithDedup<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = resourceInflight.get(key)
  if (existing) return existing as Promise<T>

  const request = loader()
  resourceInflight.set(key, request)
  const release = () => {
    // A future request may have replaced this one after an invalidation. Do
    // not remove the newer request when this older promise settles.
    if (resourceInflight.get(key) === request) resourceInflight.delete(key)
  }
  // Handle both outcomes so a rejected shared request is removed and can be
  // retried, without creating an unhandled rejected promise via `finally`.
  void request.then(release, release)
  return request
}

export type UseResourceOptions = {
  /**
   * When set, successful responses are stored and reused across remounts /
   * dependency changes. A cache hit shows data immediately (no loading flash)
   * while a background revalidate updates the entry.
   */
  cacheKey?: string | null
  /** Skip loading until prerequisite data or the consuming view is ready. */
  enabled?: boolean
}

export function clearResourceCache(prefix?: string) {
  if (!prefix) {
    resourceCache.clear()
    resourceInflight.clear()
    return
  }
  for (const key of resourceCache.keys()) {
    const logical = logicalCacheKey(key)
    if (logical === prefix || logical.startsWith(prefix)) resourceCache.delete(key)
  }
  for (const key of resourceInflight.keys()) {
    const logical = logicalCacheKey(key)
    if (logical === prefix || logical.startsWith(prefix)) resourceInflight.delete(key)
  }
}

/** Test helpers for the module-level cache. */
export function peekResourceCache(key: string) {
  return cached(scopedCacheKey(key))
}

export function writeResourceCache(key: string, value: unknown) {
  cache(scopedCacheKey(key), value)
}

type ResourceState<T> = {
  key: string | null
  data: T | null
  error: unknown
  loading: boolean
}

export function useResource<T>(
  loader: () => Promise<T>,
  dependencies: readonly unknown[] = [],
  options: UseResourceOptions = {},
) {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const logicalKey = options.cacheKey ?? null
  const cacheKey = logicalKey ? scopedCacheKey(logicalKey) : null
  const enabled = options.enabled ?? true
  const requestIdRef = useRef(0)
  const initialCached = cached<T>(cacheKey)
  const [state, setState] = useState<ResourceState<T>>({
    key: cacheKey,
    data: initialCached ?? null,
    error: null,
    loading: enabled && initialCached === undefined,
  })
  const stateRef = useRef(state)
  stateRef.current = state

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(current => {
        const next = { ...current, key: cacheKey, error: null, loading: false }
        stateRef.current = next
        return next
      })
      return undefined
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const cachedValue = cached<T>(cacheKey)
    setState(current => {
      const currentData = current.key === cacheKey ? current.data : null
      const data = cachedValue ?? currentData
      const next = {
        key: cacheKey,
        data,
        error: null,
        // A cached or already rendered value stays visible during revalidation.
        loading: data === null,
      }
      stateRef.current = next
      return next
    })

    try {
      const value = cacheKey
        ? await loadWithDedup(cacheKey, () => loaderRef.current())
        : await loaderRef.current()
      if (requestIdRef.current !== requestId) return undefined
      if (cacheKey) cache(cacheKey, value)
      const next = { key: cacheKey, data: value, error: null, loading: false }
      stateRef.current = next
      setState(next)
      return value
    } catch (error) {
      if (requestIdRef.current !== requestId) return undefined
      setState(current => {
        const next = {
          key: cacheKey,
          data: current.key === cacheKey ? current.data : (cachedValue ?? null),
          error,
          loading: false,
        }
        stateRef.current = next
        return next
      })
      return undefined
    }
  }, [cacheKey, enabled])

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1
      setState(current => {
        const next = { ...current, key: cacheKey, error: null, loading: false }
        stateRef.current = next
        return next
      })
      return
    }
    void refresh()
    return () => {
      requestIdRef.current += 1
    }
    // Consumers intentionally control reloads through the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, refresh])

  const setData: Dispatch<SetStateAction<T | null>> = useCallback(value => {
    // A mutation result is newer than any revalidation that was already in
    // flight; do not let that older response overwrite the confirmed write.
    requestIdRef.current += 1
    const current = stateRef.current
    const previous = current.key === cacheKey
      ? current.data
      : (cached<T>(cacheKey) ?? null)
    const data = typeof value === 'function'
      ? (value as (current: T | null) => T | null)(previous)
      : value
    if (cacheKey) {
      if (data === null) resourceCache.delete(cacheKey)
      else cache(cacheKey, data)
    }
    const next = { key: cacheKey, data, error: null, loading: false }
    stateRef.current = next
    setState(next)
  }, [cacheKey])

  const currentCached = state.key === cacheKey ? undefined : cached<T>(cacheKey)
  const current: ResourceState<T> = state.key === cacheKey
    ? state
    : {
        key: cacheKey,
        data: currentCached ?? null,
        error: null,
        loading: enabled && currentCached === undefined,
      }
  stateRef.current = current

  return {
    data: current.data,
    setData,
    error: current.error,
    loading: current.loading,
    refresh,
  }
}
