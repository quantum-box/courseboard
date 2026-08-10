import { useEffect, useRef, useState } from 'react'

import { courseboardApiJson } from '../../../api'
import type { Customer, CustomerList } from './models'

/**
 * Shortest string worth asking the ledger about.
 *
 * One character of a Japanese surname matches most of the tenant, which is a
 * list nobody can pick out of and a request nobody needed.
 */
const MIN_QUERY_LENGTH = 2

/** Long enough that typing a full name is one request, not six. */
const DEBOUNCE_MS = 250

export type CustomerSearchState = {
  candidates: Customer[]
  searching: boolean
  /** Set when the ledger could not be reached; the desk keeps typing regardless. */
  error: string | null
}

/**
 * Candidates for what the desk has typed so far.
 *
 * The search never blocks the field it hangs off: a booking has to be writable
 * while the ledger is slow or down, so a failure here surfaces as a note beside
 * the box and nothing else. What it returns stays a list of candidates —
 * picking is the desk's, and auto-selecting a lone match would silently attach
 * whoever happened to be the only 本田 in the ledger.
 */
export function useCustomerSearch(query: string): CustomerSearchState {
  const [state, setState] = useState<CustomerSearchState>({
    candidates: [],
    searching: false,
    error: null,
  })
  // Answers can arrive out of order; only the newest query may set state, or a
  // slow request for "本" lands on top of the results for "本田 康彦".
  const latest = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      latest.current += 1
      setState({ candidates: [], searching: false, error: null })
      return
    }

    const generation = ++latest.current
    setState(current => ({ ...current, searching: true }))
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await courseboardApiJson<CustomerList>(
            `/v1/course/customers?name=${encodeURIComponent(trimmed)}`,
          )
          if (latest.current !== generation) return
          setState({ candidates: found.items ?? [], searching: false, error: null })
        } catch (error) {
          if (latest.current !== generation) return
          setState({
            candidates: [],
            searching: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  return state
}
