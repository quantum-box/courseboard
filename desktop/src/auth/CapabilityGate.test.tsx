/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { FIELD_ACTIONS } from './capabilityRoutes'
import { CapabilityGate } from './CapabilityGate'
import { useEffectiveCapabilities } from './EffectiveCapabilitiesProvider'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../components/Page', () => ({
  Notice: ({ children }: { children: ReactNode }) => (
    <div data-testid="forbidden">{children}</div>
  ),
}))

vi.mock('./EffectiveCapabilitiesProvider', () => ({
  useEffectiveCapabilities: vi.fn(),
}))

const useCapabilities = vi.mocked(useEffectiveCapabilities)

const capabilities = {
  actions: {},
  navigation: { otherBusinessAccess: false },
  agentDocuments: {
    invoices: { list: false, send: false },
    quotations: { list: false, send: false },
  },
  cancellationFees: { list: false, manage: false },
}

describe('CapabilityGate', () => {
  afterEach(cleanup)

  beforeEach(() => {
    useCapabilities.mockReturnValue({
      tenantId: 'tenant-a',
      userId: 'user-a',
      data: capabilities,
      error: null,
      loading: false,
      capabilities,
    })
  })

  it('lets an unknown route reach RouteContent for its NotFound result', () => {
    render(
      <CapabilityGate route="unknown-authenticated-route">
        <div data-testid="route-content">not found</div>
      </CapabilityGate>,
    )

    expect(screen.getByTestId('route-content').textContent).toBe('not found')
    expect(screen.queryByTestId('forbidden')).toBeNull()
  })

  it('keeps a known route with an explicit denial forbidden', () => {
    useCapabilities.mockReturnValue({
      tenantId: 'tenant-a',
      userId: 'user-a',
      data: {
        ...capabilities,
        actions: { [FIELD_ACTIONS.listCourses]: false },
      },
      error: null,
      loading: false,
      capabilities: {
        ...capabilities,
        actions: { [FIELD_ACTIONS.listCourses]: false },
      },
    })

    render(
      <CapabilityGate route="golf/courses">
        <div data-testid="route-content">business loader</div>
      </CapabilityGate>,
    )

    expect(screen.getByTestId('forbidden').textContent).toBe('error.forbidden')
    expect(screen.queryByTestId('route-content')).toBeNull()
  })

  it('does not grant a known route whose action is still unknown', () => {
    useCapabilities.mockReturnValue({
      tenantId: 'tenant-a',
      userId: 'user-a',
      data: {
        ...capabilities,
        actions: { [FIELD_ACTIONS.listCourses]: null },
      },
      error: null,
      loading: false,
      capabilities: {
        ...capabilities,
        actions: { [FIELD_ACTIONS.listCourses]: null },
      },
    })

    render(
      <CapabilityGate route="golf/courses">
        <div data-testid="route-content">business loader</div>
      </CapabilityGate>,
    )

    expect(screen.getByTestId('forbidden').textContent).toBe('error.forbidden')
    expect(screen.queryByTestId('route-content')).toBeNull()
  })
})
