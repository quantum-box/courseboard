/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { normalizeIsoDate } from './clock'
import { replaceRouteSearchParams, useRouteParamState } from './router'

beforeEach(() => {
  window.history.replaceState(null, '', '/tn_1/golf/ledger')
})

afterEach(cleanup)

function renderDate(fallback = '2026-08-17') {
  return renderHook(() => useRouteParamState('date', { fallback, normalize: normalizeIsoDate }))
}

describe('a screen filter kept in the URL', () => {
  it('opens on the day the link names', () => {
    window.history.replaceState(null, '', '/tn_1/golf/ledger?date=2026-08-12')

    const { result } = renderDate()

    expect(result.current[0]).toBe('2026-08-12')
  })

  it('falls back when the link names no day, or one nobody could show', () => {
    // A hand-edited or truncated link is not an error the desk has to answer:
    // the board opens on today rather than on an error state.
    const { result } = renderDate()
    expect(result.current[0]).toBe('2026-08-17')

    cleanup()
    window.history.replaceState(null, '', '/tn_1/golf/ledger?date=2026-02-31')
    expect(renderDate().result.current[0]).toBe('2026-08-17')
  })

  it('writes the day into the link without stacking up history', () => {
    // Paging through a week is one screen looking elsewhere. If each day were a
    // history entry, back would stop meaning "the screen before this one".
    const { result } = renderDate()
    expect(`${window.location.pathname}${window.location.search}`).toBe('/tn_1/golf/ledger?date=2026-08-17')

    const before = window.history.length
    act(() => result.current[1]('2026-08-20'))

    expect(`${window.location.pathname}${window.location.search}`).toBe('/tn_1/golf/ledger?date=2026-08-20')
    expect(window.history.length).toBe(before)
  })

  it('keeps the day across a move that carries it on the route', () => {
    // Switching tabs inside one screen goes through `navigate`, which rebuilds
    // the hash from the route alone — so those call sites put the day on the
    // route. Leaving the screen, the day goes with it.
    const { result } = renderDate()
    act(() => result.current[1]('2026-08-20'))

    act(() => {
      window.history.replaceState(null, '', '/tn_1/golf/caddies/attendance?date=2026-08-20')
      window.dispatchEvent(new Event('popstate'))
    })

    expect(result.current[0]).toBe('2026-08-20')
  })

  it('falls back when a route arrives with no day on it', () => {
    // The screens that must not lose the day pass it on the route. Everything
    // else — the sidebar, ⌘K — is a fresh look at a screen, which is today.
    const { result } = renderDate()
    act(() => result.current[1]('2026-08-20'))

    act(() => {
      window.history.replaceState(null, '', '/tn_1/golf/ledger')
      window.dispatchEvent(new Event('popstate'))
    })

    expect(result.current[0]).toBe('2026-08-17')
  })

  it('follows the URL when the operator goes back', () => {
    const { result } = renderDate()

    act(() => {
      window.history.replaceState(null, '', '/tn_1/golf/ledger?date=2026-09-01')
      window.dispatchEvent(new Event('popstate'))
    })

    expect(result.current[0]).toBe('2026-09-01')
  })

  it('leaves the parameters other screens put there alone', () => {
    window.history.replaceState(null, '', '/tn_1/golf/ledger?yearMonth=2026-08')

    renderDate()

    expect(`${window.location.pathname}${window.location.search}`).toBe('/tn_1/golf/ledger?yearMonth=2026-08&date=2026-08-17')
    act(() => replaceRouteSearchParams({ yearMonth: null }))
    expect(`${window.location.pathname}${window.location.search}`).toBe('/tn_1/golf/ledger?date=2026-08-17')
  })
})
