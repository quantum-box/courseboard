/* @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { FIELD_ACTIONS } from './auth/capabilityRoutes'
import { clearResourceCache } from './hooks/useResource'
import { i18next } from './i18n'

const authAdapter = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  getAccessToken: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('./auth/adapters', () => ({ createAuthAdapter: () => authAdapter }))

const feeOnlyCapabilities = {
  actions: Object.fromEntries(Object.values(FIELD_ACTIONS).map(action => [action, false])),
  navigation: { otherBusinessAccess: false },
  agentDocuments: {
    invoices: { list: false, send: false },
    quotations: { list: false, send: false },
  },
  cancellationFees: { list: true, manage: true },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestedPaths(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(call => {
    const input = call[0] as RequestInfo | URL
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return new URL(url, 'http://localhost').pathname
  })
}

beforeEach(async () => {
  await i18next.changeLanguage('ja')
  clearResourceCache()
  localStorage.clear()
  window.history.replaceState({}, '', '/tenant-1/golf')
  vi.stubEnv('VITE_COURSEBOARD_API_BASE_URL', '')
  vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'browser-pkce')
  vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
  authAdapter.bootstrap.mockResolvedValue({
    kind: 'authenticated',
    user: { id: 'fee-only-user', name: 'Fee Operator', role: 'MEMBER' },
    tenants: [{
      id: 'tenant-1',
      name: 'Test Course',
      mode: 'production',
      platformId: 'platform-1',
      operatorId: 'tenant-1',
    }],
  })
  authAdapter.getAccessToken.mockResolvedValue('fee-only-access-token')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('opens the cancellation-fee list for a fee-only operator without touching other business APIs', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/v1/field/client-capabilities') return json(feeOnlyCapabilities)
    if (path === '/v1/course/tenant-timezone') return json({ timezone: 'Asia/Tokyo' })
    if (path.includes('cancellation-fee')) return json({ items: [] })
    return json({ error: 'not_stubbed' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<I18nextProvider i18n={i18next}><App /></I18nextProvider>)

  await waitFor(() => expect(window.location.pathname).toBe('/tenant-1/cancellation-fees'))
  await waitFor(() => {
    expect(requestedPaths(fetchMock).some(path => path.includes('cancellation-fee'))).toBe(true)
  })

  const paths = requestedPaths(fetchMock)
  expect(paths).toContain('/v1/field/client-capabilities')
  expect(paths).not.toContain('/v1/course/extension-status')
  expect(paths.filter(path => path.startsWith('/v1/course/customers'))).toEqual([])
  expect(paths.filter(path => /reservation|tee-ledger|tee-sheet/.test(path))).toEqual([])
})
