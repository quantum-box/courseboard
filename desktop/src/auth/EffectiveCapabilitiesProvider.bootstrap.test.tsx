/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilityGate } from './CapabilityGate'
import { EffectiveCapabilitiesProvider } from './EffectiveCapabilitiesProvider'
import { FIELD_ACTIONS } from './capabilityRoutes'

const harness = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  route: 'golf',
  tenantId: 'tenant-a' as string | undefined,
  userId: 'user-a' as string | undefined,
}))

vi.mock('../api', () => ({ courseboardApiJson: harness.api }))
vi.mock('../lib/router', () => ({
  navigate: harness.navigate,
  useRoute: () => harness.route,
}))
vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    tenant: harness.tenantId ? { id: harness.tenantId } : undefined,
    user: harness.userId ? { id: harness.userId } : undefined,
  }),
}))
vi.mock('../components/Page', () => ({
  LoadingState: () => <div data-testid="capability-loading">Loading</div>,
  Notice: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  ResourceError: ({ onRetry }: { onRetry?: () => void }) => (
    <div data-testid="capability-error">
      <button type="button" onClick={onRetry}>Retry</button>
    </div>
  ),
}))

const allActionsAllowed = Object.fromEntries(
  Object.values(FIELD_ACTIONS).map(action => [action, true]),
)

const completeCapabilities = {
  actions: allActionsAllowed,
  navigation: { otherBusinessAccess: true },
  agentDocuments: {
    invoices: { list: true, send: false },
    quotations: { list: false, send: false },
  },
  cancellationFees: { list: true, manage: false },
}

const feeCapabilitiesWithUnknownNavigation = {
  ...completeCapabilities,
  actions: {},
  navigation: { otherBusinessAccess: null },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderProvider() {
  return render(
    <EffectiveCapabilitiesProvider>
      <div data-testid="business-screen">business</div>
    </EffectiveCapabilitiesProvider>,
  )
}

describe('EffectiveCapabilitiesProvider bootstrap gate', () => {
  beforeEach(() => {
    harness.api.mockReset()
    harness.navigate.mockReset()
    harness.route = 'golf'
    harness.tenantId = 'tenant-a'
    harness.userId = 'user-a'
  })

  afterEach(cleanup)

  it('keeps business children unmounted until the selected tenant snapshot arrives', async () => {
    const request = deferred<typeof completeCapabilities>()
    harness.api.mockReturnValue(request.promise)

    renderProvider()

    expect(screen.getByTestId('capability-loading')).toBeTruthy()
    expect(screen.queryByTestId('business-screen')).toBeNull()

    await act(async () => request.resolve(completeCapabilities))
    expect(await screen.findByTestId('business-screen')).toBeTruthy()
  })

  it('shows a retryable error and keeps non-fee children blocked for partial navigation data', async () => {
    harness.api.mockResolvedValueOnce(feeCapabilitiesWithUnknownNavigation)
      .mockResolvedValueOnce(completeCapabilities)

    renderProvider()

    expect(await screen.findByTestId('capability-error')).toBeTruthy()
    expect(screen.queryByTestId('business-screen')).toBeNull()

    screen.getByRole('button', { name: 'Retry' }).click()
    expect(await screen.findByTestId('business-screen')).toBeTruthy()
    expect(harness.api).toHaveBeenCalledTimes(2)
  })

  it('allows a fee deep link when fee actions are known even if navigation aggregate is incomplete', async () => {
    harness.route = 'cancellation-fees/inv-1'
    harness.api.mockResolvedValue(feeCapabilitiesWithUnknownNavigation)

    renderProvider()

    expect(await screen.findByTestId('business-screen')).toBeTruthy()
    expect(screen.queryByTestId('capability-error')).toBeNull()
  })

  it('does not let a stale tenant response unlock the next tenant', async () => {
    const first = deferred<typeof completeCapabilities>()
    const second = deferred<typeof completeCapabilities>()
    harness.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const view = renderProvider()
    harness.tenantId = 'tenant-b'
    view.rerender(
      <EffectiveCapabilitiesProvider>
        <div data-testid="business-screen">business</div>
      </EffectiveCapabilitiesProvider>,
    )
    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('business-screen')).toBeNull()

    await act(async () => first.resolve(completeCapabilities))
    expect(screen.queryByTestId('business-screen')).toBeNull()

    await act(async () => second.resolve(completeCapabilities))
    await waitFor(() => expect(screen.getByTestId('business-screen')).toBeTruthy())
  })

  it('does not let a same-tenant user response unlock the next principal', async () => {
    const first = deferred<typeof completeCapabilities>()
    const second = deferred<typeof completeCapabilities>()
    harness.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const view = renderProvider()
    harness.userId = 'user-b'
    view.rerender(
      <EffectiveCapabilitiesProvider>
        <div data-testid="business-screen">business</div>
      </EffectiveCapabilitiesProvider>,
    )
    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('business-screen')).toBeNull()

    await act(async () => first.resolve(completeCapabilities))
    expect(screen.queryByTestId('business-screen')).toBeNull()

    await act(async () => second.resolve(completeCapabilities))
    await waitFor(() => expect(screen.getByTestId('business-screen')).toBeTruthy())
  })

  it('clears a completed same-tenant snapshot before loading the next principal', async () => {
    const first = deferred<typeof completeCapabilities>()
    const second = deferred<typeof completeCapabilities>()
    harness.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const view = renderProvider()
    await act(async () => first.resolve(completeCapabilities))
    expect(await screen.findByTestId('business-screen')).toBeTruthy()

    harness.userId = 'user-b'
    view.rerender(
      <EffectiveCapabilitiesProvider>
        <div data-testid="business-screen">business</div>
      </EffectiveCapabilitiesProvider>,
    )
    await waitFor(() => expect(screen.queryByTestId('business-screen')).toBeNull())

    await act(async () => second.resolve(completeCapabilities))
    await waitFor(() => expect(screen.getByTestId('business-screen')).toBeTruthy())
  })

  it('shows a retryable error instead of business children for a capability permission failure', async () => {
    harness.api.mockRejectedValue(new Error('Request failed with 403'))

    renderProvider()

    expect(await screen.findByTestId('capability-error')).toBeTruthy()
    expect(screen.queryByTestId('business-screen')).toBeNull()
  })
})

const feeListCapabilities = {
  ...completeCapabilities,
  cancellationFees: { list: true, manage: true },
}

const feeListRevoked = {
  ...completeCapabilities,
  cancellationFees: { list: false, manage: false },
}

function feeScreen() {
  return (
    <EffectiveCapabilitiesProvider>
      <CapabilityGate route="cancellation-fees">
        <div data-testid="fee-screen">fees</div>
      </CapabilityGate>
    </EffectiveCapabilitiesProvider>
  )
}

function renderFeeScreen() {
  return render(feeScreen())
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  fireEvent(document, new Event('visibilitychange'))
}

function hangs() {
  return deferred<typeof feeListCapabilities>().promise
}

describe('EffectiveCapabilitiesProvider revocation', () => {
  beforeEach(() => {
    // The age limit runs on the monotonic clock, so it has to move with the timers.
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'Date',
        'performance',
      ],
    })
    harness.api.mockReset()
    harness.navigate.mockReset()
    harness.route = 'cancellation-fees'
    harness.tenantId = 'tenant-a'
    harness.userId = 'user-a'
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(document, 'visibilityState')
    vi.useRealTimers()
  })

  it('closes an open protected screen when the minute refresh revokes its action', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities).mockResolvedValueOnce(feeListRevoked)
    renderFeeScreen()
    await flush()
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await advance(60_000)
    await flush()

    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('closes an open protected screen when a focus refresh revokes its action', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities).mockResolvedValueOnce(feeListRevoked)
    renderFeeScreen()
    await flush()
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    fireEvent.focus(window)
    await flush()

    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
  })

  it('closes an open protected screen when the window becomes visible again and the refresh revokes its action', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities).mockResolvedValueOnce(feeListRevoked)
    renderFeeScreen()
    await flush()

    setVisibility('hidden')
    await flush()
    expect(harness.api).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    setVisibility('visible')
    await flush()
    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
  })

  it('keeps the open screen mounted while a background refresh is in flight', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities).mockReturnValueOnce(hangs())
    renderFeeScreen()
    await flush()

    fireEvent.focus(window)
    await flush()

    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
    expect(screen.queryByTestId('capability-loading')).toBeNull()
  })

  it('keeps a revoked screen closed when a later refresh fails', async () => {
    harness.api.mockResolvedValueOnce(feeListRevoked).mockRejectedValueOnce(new Error('Request failed with 503'))
    renderFeeScreen()
    await flush()
    expect(screen.queryByTestId('fee-screen')).toBeNull()

    fireEvent.focus(window)
    await flush()

    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('keeps the open screen through failed refreshes within two minutes of the last answer', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockRejectedValueOnce(new Error('Request failed with 503'))
      .mockRejectedValueOnce(new Error('Request failed with 503'))
    renderFeeScreen()
    await flush()

    await advance(60_000)
    await flush()
    await advance(59_999)
    fireEvent.focus(window)
    await flush()

    expect(harness.api).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
    expect(screen.queryByTestId('capability-error')).toBeNull()
  })

  it('closes the open screen once refreshes keep failing past two minutes, and reopens on the next answer', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockRejectedValueOnce(new Error('Request failed with 503'))
      .mockRejectedValueOnce(new Error('Request failed with 503'))
      .mockRejectedValueOnce(new Error('Request failed with 503'))
      .mockResolvedValueOnce(feeListCapabilities)
    renderFeeScreen()
    await flush()

    await advance(60_000)
    await flush()
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await advance(60_001)
    fireEvent.focus(window)
    await flush()

    expect(harness.api).toHaveBeenCalledTimes(4)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByTestId('capability-error')).toBeTruthy()

    fireEvent.focus(window)
    await flush()
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
  })

  it('lets a refresh slower than the period finish instead of restarting it', async () => {
    const slow = deferred<typeof feeListCapabilities>()
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(feeListCapabilities)
    renderFeeScreen()
    await flush()

    await advance(90_000)
    fireEvent.focus(window)
    await advance(29_999)
    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await act(async () => slow.resolve(feeListRevoked))
    expect(screen.queryByTestId('fee-screen')).toBeNull()
  })

  it('lets a first load slower than the period finish', async () => {
    const slow = deferred<typeof feeListCapabilities>()
    harness.api.mockReturnValueOnce(slow.promise).mockResolvedValue(feeListCapabilities)
    renderFeeScreen()

    await advance(90_000)
    fireEvent.focus(window)
    expect(harness.api).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('capability-loading')).toBeTruthy()

    await act(async () => slow.resolve(feeListCapabilities))
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
  })

  it('offers retry once a first load outlives two minutes, and opens on the next timely answer', async () => {
    const hung = deferred<typeof feeListCapabilities>()
    const next = deferred<typeof feeListCapabilities>()
    harness.api.mockReturnValueOnce(hung.promise).mockReturnValueOnce(next.promise)
    renderFeeScreen()

    await advance(119_999)
    expect(screen.getByTestId('capability-loading')).toBeTruthy()

    await advance(1)
    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('capability-loading')).toBeNull()
    expect(screen.getByTestId('capability-error')).toBeTruthy()

    await act(async () => hung.resolve(feeListCapabilities))
    expect(screen.queryByTestId('fee-screen')).toBeNull()

    await act(async () => next.resolve(feeListCapabilities))
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
  })

  it('closes the open screen the moment a hung refresh lets its decision turn two minutes old, and lets retry replace it', async () => {
    const hung = deferred<typeof feeListCapabilities>()
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(hung.promise)
      .mockResolvedValueOnce(feeListCapabilities)
    renderFeeScreen()
    await flush()

    await advance(119_999)
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await advance(1)
    expect(harness.api).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByTestId('capability-error')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flush()
    expect(harness.api).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await act(async () => hung.resolve(feeListRevoked))
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
  })

  it('closes the open screen when its decision turns two minutes old between refreshes', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(hangs())
    renderFeeScreen()
    await flush()

    await advance(30_000)
    fireEvent.focus(window)
    await flush()
    await advance(119_999)
    expect(harness.api).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await advance(1)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByTestId('capability-error')).toBeTruthy()
  })

  it('keeps the screen closed when a hung refresh answers only after its decision would be two minutes old', async () => {
    const hung = deferred<typeof feeListCapabilities>()
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(hung.promise)
      .mockReturnValueOnce(hangs())
    renderFeeScreen()
    await flush()

    await advance(180_000)
    await act(async () => hung.resolve(feeListCapabilities))

    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByTestId('capability-error')).toBeTruthy()
  })

  it('reopens on a refresh that answers after the screen closed but within two minutes of being sent', async () => {
    const slow = deferred<typeof feeListCapabilities>()
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(hangs())
    renderFeeScreen()
    await flush()

    await advance(150_000)
    expect(screen.queryByTestId('fee-screen')).toBeNull()

    await act(async () => slow.resolve(feeListCapabilities))
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await advance(30_000)
    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByTestId('capability-error')).toBeTruthy()
  })

  it('keeps retry on screen while background refreshes run after closing, and reopens on their answer', async () => {
    const failing = deferred<typeof feeListCapabilities>()
    const recovering = deferred<typeof feeListCapabilities>()
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(failing.promise)
      .mockReturnValueOnce(hangs())
      .mockReturnValueOnce(recovering.promise)
    renderFeeScreen()
    await flush()

    await advance(121_000)
    await act(async () => failing.reject(new Error('Request failed with 503')))
    expect(screen.getByTestId('capability-error')).toBeTruthy()

    await advance(59_000)
    expect(harness.api).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('capability-error')).toBeTruthy()
    expect(screen.queryByTestId('capability-loading')).toBeNull()

    await advance(180_000)
    expect(harness.api).toHaveBeenCalledTimes(4)
    expect(screen.getByTestId('capability-error')).toBeTruthy()
    expect(screen.queryByTestId('capability-loading')).toBeNull()

    await act(async () => recovering.resolve(feeListCapabilities))
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
  })

  it('still closes when the wall clock is set back', async () => {
    harness.api.mockResolvedValueOnce(feeListCapabilities).mockReturnValue(hangs())
    renderFeeScreen()
    await flush()

    vi.setSystemTime(Date.now() - 60 * 60_000)
    await advance(180_000)

    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(screen.getByTestId('capability-error')).toBeTruthy()
  })

  it('drops a late answer from an earlier visit when switching tenants away and back', async () => {
    const lateRefresh = deferred<typeof feeListCapabilities>()
    const tenantB = deferred<typeof feeListCapabilities>()
    const tenantAAgain = deferred<typeof feeListCapabilities>()
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(lateRefresh.promise)
      .mockReturnValueOnce(tenantB.promise)
      .mockReturnValueOnce(tenantAAgain.promise)
    const view = renderFeeScreen()
    await flush()
    fireEvent.focus(window)
    await flush()

    harness.tenantId = 'tenant-b'
    view.rerender(feeScreen())
    harness.tenantId = 'tenant-a'
    view.rerender(feeScreen())
    await act(async () => tenantAAgain.resolve(feeListRevoked))
    expect(screen.queryByTestId('fee-screen')).toBeNull()

    await act(async () => lateRefresh.resolve(feeListCapabilities))
    expect(screen.queryByTestId('fee-screen')).toBeNull()
    expect(harness.api).toHaveBeenCalledTimes(4)
  })

  it('keeps tenant B\'s late answer out of tenant A after switching back', async () => {
    const tenantB = deferred<typeof feeListCapabilities>()
    const tenantAAgain = deferred<typeof feeListCapabilities>()
    harness.api.mockResolvedValueOnce(feeListCapabilities)
      .mockReturnValueOnce(tenantB.promise)
      .mockReturnValueOnce(tenantAAgain.promise)
    const view = renderFeeScreen()
    await flush()

    harness.tenantId = 'tenant-b'
    view.rerender(feeScreen())
    harness.tenantId = 'tenant-a'
    view.rerender(feeScreen())
    await act(async () => tenantAAgain.resolve(feeListCapabilities))
    expect(screen.getByTestId('fee-screen')).toBeTruthy()

    await act(async () => tenantB.resolve(feeListRevoked))
    expect(screen.getByTestId('fee-screen')).toBeTruthy()
    expect(screen.queryByTestId('capability-loading')).toBeNull()
  })

  it('stops refreshing after unmount', async () => {
    harness.api.mockResolvedValue(feeListCapabilities)
    const view = renderFeeScreen()
    await flush()
    expect(harness.api).toHaveBeenCalledTimes(1)

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await advance(300_000)
    fireEvent.focus(window)
    setVisibility('visible')
    await flush()

    expect(harness.api).toHaveBeenCalledTimes(1)
  })
})
