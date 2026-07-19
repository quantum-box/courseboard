import { useCallback, useEffect, useRef, useState } from 'react'

const resourceCache = new Map<string, unknown>()

export type UseResourceOptions = {
  /**
   * When set, successful responses are stored and reused across remounts /
   * dependency changes. A cache hit shows data immediately (no loading flash)
   * while a background revalidate updates the entry.
   */
  cacheKey?: string | null
}

export function clearResourceCache(prefix?: string) {
  if (!prefix) {
    resourceCache.clear()
    return
  }
  for (const key of resourceCache.keys()) {
    if (key === prefix || key.startsWith(prefix)) resourceCache.delete(key)
  }
}

/** Test helpers for the module-level cache. */
export function peekResourceCache(key: string) {
  return resourceCache.get(key)
}

export function writeResourceCache(key: string, value: unknown) {
  resourceCache.set(key, value)
}

export function useResource<T>(
  loader: () => Promise<T>,
  dependencies: readonly unknown[] = [],
  options: UseResourceOptions = {},
) {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const cacheKey = options.cacheKey ?? null
  const initialCached = cacheKey
    ? resourceCache.get(cacheKey) as T | undefined
    : undefined
  const [data, setData] = useState<T | null>(initialCached ?? null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(initialCached === undefined)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    let active = true
    const cached = cacheKey
      ? resourceCache.get(cacheKey) as T | undefined
      : undefined
    if (cached !== undefined) {
      setData(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)
    loaderRef.current()
      .then(value => {
        if (cacheKey) resourceCache.set(cacheKey, value)
        if (active) setData(value)
      })
      .catch(reason => {
        if (active) setError(reason)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // Consumers intentionally control reloads through the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision, cacheKey])

  return { data, setData, error, loading, refresh }
}
