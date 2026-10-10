/* @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { i18next } from './i18n'
import App from './App'
const state = vi.hoisted(() => ({ gate: 'hidden', route: 'golf/data-imports/courseboardReservationReports/documents' }))
vi.mock('./lib/router', () => ({ useRoute: () => state.route, navigate: vi.fn() }))
vi.mock('./feature-flags/gated-routes', () => ({ useRouteGate: () => state.gate }))
vi.mock('./feature-flags/FeatureFlags', () => ({ FeatureFlagProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./auth/AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./auth/EffectiveCapabilitiesProvider', () => ({
  EffectiveCapabilitiesProvider: ({ children }: { children: ReactNode }) => children,
  useEffectiveCapabilities: () => ({
    capabilities: {
      actions: { 'field:ListBridgeDefinitions': true },
      navigation: { otherBusinessAccess: null },
      agentDocuments: {
        invoices: { list: false, send: false },
        quotations: { list: false, send: false },
      },
      cancellationFees: { list: false, manage: false },
    },
  }),
}))
vi.mock('./auth/AuthGate', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }))
vi.mock('./context/TenantTimezoneProvider', () => ({ TenantTimezoneProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./components/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, golfNavigation: [] }))
vi.mock('./components/MacOSTabStrip', () => ({ MacOSTabStrip: () => null }))
vi.mock('./lib/pageMetadata', () => ({ PageMetadata: () => null }))
vi.mock('./features/golf/common-imports/ReservationDocumentPage', () => ({ ReservationDocumentPage: () => <div>document-workflow</div> }))
afterEach(cleanup)
for (const route of ['golf/data-imports/courseboardReservationReports/documents', 'golf/data-imports/courseboardReservationReports/documents/dtj_saved']) {
  it(`does not mount a hidden PDF workflow through ${route}`, async () => {
    await i18next.changeLanguage('ja')
    state.route = route; state.gate = 'hidden'
    render(<I18nextProvider i18n={i18next}><App /></I18nextProvider>)
    expect(screen.queryByText('document-workflow')).toBeNull()
    expect(screen.getByRole('heading')).toBeDefined()
  })
}
it('mounts the PDF workflow only after its gate is visible', () => {
  state.gate = 'visible'
  render(<I18nextProvider i18n={i18next}><App /></I18nextProvider>)
  expect(screen.getByText('document-workflow')).toBeDefined()
})
