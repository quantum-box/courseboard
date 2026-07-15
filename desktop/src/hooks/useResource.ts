import { useCallback, useEffect, useRef, useState } from 'react'

export function useResource<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    loaderRef.current()
      .then(value => {
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
  }, [...dependencies, revision])

  return { data, setData, error, loading, refresh }
}
