import { useRef } from 'react'

/**
 * The last value that arrived, kept while the next one loads.
 *
 * A server-paged table re-reads on every page turn. Letting the rows go blank
 * in between collapses the pager under the pointer and throws the scroll
 * position away; showing the previous page, dimmed, until the next one lands
 * does neither.
 */
export function useKeptData<T>(data: T | null | undefined): T | null {
  const kept = useRef<T | null>(null)
  if (data !== null && data !== undefined) kept.current = data
  return data ?? kept.current
}
