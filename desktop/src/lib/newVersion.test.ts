// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNewVersionAvailable } from './newVersion'

const INTERVAL_MS = 1000

function setEntryScript(src: string) {
  document.body.innerHTML = `<script type="module" src="${src}"></script>`
}

function htmlWithEntryScript(src: string) {
  return `<!doctype html><html><head></head><body><script type="module" src="${src}"></script></body></html>`
}

beforeEach(() => {
  vi.useFakeTimers()
  setEntryScript('/assets/app-aaaaaaaa.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useNewVersionAvailable', () => {
  it('flags a new version once the polled index.html serves a different bundle', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(htmlWithEntryScript('/assets/app-bbbbbbbb.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))
    expect(result.current).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it('stays false while the polled bundle hash is unchanged', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(htmlWithEntryScript('/assets/app-aaaaaaaa.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3) })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current).toBe(false)
  })

  it('does not treat a fetch failure as a new version', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2) })

    expect(fetchMock).toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  it('stops polling once a new version has already been detected', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(htmlWithEntryScript('/assets/app-bbbbbbbb.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS) })
    expect(result.current).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never polls when running under Tauri', async () => {
    vi.stubGlobal('isTauri', true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3) })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
