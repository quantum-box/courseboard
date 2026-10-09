/* @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
