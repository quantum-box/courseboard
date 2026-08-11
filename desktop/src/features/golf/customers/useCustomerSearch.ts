import { useEffect, useRef, useState } from 'react'

import { courseboardApiJson } from '../../../api'
import type { Customer, CustomerList } from './models'

/** Long enough that typing a full name is one request, not six. */
const DEBOUNCE_MS = 250

export type CustomerSearchParameter = 'name' | 'phone' | 'email'

const PHONE_DIGIT = /[0-9０-９]/u
const PHONE_CHARACTERS = /^[0-9０-９\s()+.‐‑‒–—―−ー－-]+$/u

/**
 * Route the ledger's single box onto Field's three distinct filters.
 *
 * An at-sign is unambiguous enough to prefer the exact email filter. A phone
 * search must contain a digit and only digits or familiar phone separators;
 * notably, full-width digits stay untouched for Field to normalise. Everything
 * else is a name query, which Field also matches against the kana reading.
 */
export function customerSearchParameter(query: string): CustomerSearchParameter | null {
  const trimmed = query.trim()
  if (!trimmed) return null
  if (trimmed.includes('@')) return 'email'
  if (PHONE_DIGIT.test(trimmed) && PHONE_CHARACTERS.test(trimmed)) return 'phone'
  return 'name'
}

export function customerSearchPath(query: string): string | null {
  const trimmed = query.trim()
  const parameter = customerSearchParameter(trimmed)
  if (!parameter) return null
  return `/v1/course/customers?${parameter}=${encodeURIComponent(trimmed)}`
}

export type CustomerSearchState = {
  candidates: Customer[]
  searching: boolean
  /** Trimmed input for which `candidates` is the completed answer. */
  completedQuery: string | null
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
    completedQuery: null,
    error: null,
  })
  // Answers can arrive out of order; only the newest query may set state, or a
  // slow request for "本" lands on top of the results for "本田 康彦".
  const latest = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    const path = customerSearchPath(trimmed)
    if (!path) {
      latest.current += 1
      setState({ candidates: [], searching: false, completedQuery: null, error: null })
      return
    }

    const generation = ++latest.current
    setState({ candidates: [], searching: true, completedQuery: null, error: null })
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await courseboardApiJson<CustomerList>(path)
          if (latest.current !== generation) return
          setState({
            candidates: found.items ?? [],
            searching: false,
            completedQuery: trimmed,
            error: null,
          })
        } catch (error) {
          if (latest.current !== generation) return
          setState({
            candidates: [],
            searching: false,
            completedQuery: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  return state
}
