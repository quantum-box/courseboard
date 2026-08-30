// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basePath } from './router'
import { CHECK_TIMEOUT_MS, useNewVersionAvailable } from './newVersion'

const INTERVAL_MS = 1000

function setEntryScript(src: string) {
  document.body.innerHTML = `<script type="module" src="${src}"></script>`
}

function htmlWithEntryScript(src: string) {
  return `<!doctype html><html><head></head><body><script type="module" src="${src}"></script></body></html>`
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  setEntryScript('/assets/app-aaaaaaaa.js')
})

afterEach(() => {
  // Without this, a previous test's mounted hook keeps its interval and
  // visibilitychange listener alive and reacts to the next test's fetch mock.
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useNewVersionAvailable', () => {
  it('flags a new version once the mismatch is observed twice in a row', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(htmlWithEntryScript('/assets/app-bbbbbbbb.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))
    expect(result.current).toBe(false)

    await tick(INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // A single differing poll is not enough — could be a rolling deploy.
    expect(result.current).toBe(false)

    await tick(INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(true)
  })

  it('resets the mismatch streak when a poll in between still matches the baseline', async () => {
    const responses = [
      htmlWithEntryScript('/assets/app-bbbbbbbb.js'),
      htmlWithEntryScript('/assets/app-aaaaaaaa.js'),
      htmlWithEntryScript('/assets/app-bbbbbbbb.js'),
      htmlWithEntryScript('/assets/app-bbbbbbbb.js'),
    ]
    let call = 0
    const fetchMock = vi.fn(async () => new Response(responses[call++], { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await tick(INTERVAL_MS)
    expect(result.current).toBe(false)
    await tick(INTERVAL_MS)
    expect(result.current).toBe(false)
    await tick(INTERVAL_MS)
    expect(result.current).toBe(false)
    await tick(INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.current).toBe(true)
  })

  it('stays false while the polled bundle hash is unchanged', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(htmlWithEntryScript('/assets/app-aaaaaaaa.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await tick(INTERVAL_MS * 3)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current).toBe(false)
  })

  it('does not treat a fetch failure as a new version', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await tick(INTERVAL_MS * 2)

    expect(fetchMock).toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  it('stops polling once a new version has already been detected', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(htmlWithEntryScript('/assets/app-bbbbbbbb.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await tick(INTERVAL_MS * 2)
    expect(result.current).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await tick(INTERVAL_MS * 3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('passes basePath() and cache: no-store to fetch', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(htmlWithEntryScript('/assets/app-aaaaaaaa.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useNewVersionAvailable(INTERVAL_MS))
    await tick(INTERVAL_MS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(basePath())
    expect(init?.cache).toBe('no-store')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts a request that never responds after the timeout, and does not get stuck', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await tick(INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(capturedSignal?.aborted).toBe(false)

    await tick(CHECK_TIMEOUT_MS)
    expect(capturedSignal?.aborted).toBe(true)

    // `checking` must have been released by the abort, so the next tick polls again.
    await tick(INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts an in-flight request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() => useNewVersionAvailable(INTERVAL_MS))
    await tick(INTERVAL_MS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(capturedSignal?.aborted).toBe(false)

    unmount()
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('checks again on visibility return, but not twice within the minimum gap', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(htmlWithEntryScript('/assets/app-aaaaaaaa.js'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get')

    // A far longer interval than MIN_CHECK_GAP_MS, so only visibilitychange
    // drives checks in this test — the setInterval poll never fires.
    const LONG_INTERVAL_MS = 10 * 60 * 1000
    renderHook(() => useNewVersionAvailable(LONG_INTERVAL_MS))

    visibilityState.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      // Fully settle the check's promise chain (fetch + response.text()) even
      // though no fake time passes, so the next assertion isn't racing it.
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Immediately again, same instant: within MIN_CHECK_GAP_MS of the check
    // above — skipped by the gap guard, not merely by an in-flight request.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Far enough past the minimum gap: a visibility return checks again.
    await tick(61_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    visibilityState.mockRestore()
  })

  it('never polls when running under Tauri', async () => {
    vi.stubGlobal('isTauri', true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await tick(INTERVAL_MS * 3)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never polls when served from file:', async () => {
    vi.stubGlobal('location', { ...window.location, protocol: 'file:' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useNewVersionAvailable(INTERVAL_MS))

    await tick(INTERVAL_MS * 3)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
