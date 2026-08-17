import { Button } from '@tachyon-sdk/native-ui'
import { ArrowLeft, MapPin } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthGate } from './auth/AuthGate'
import { AuthProvider } from './auth/AuthProvider'
import { AppShell } from './components/AppShell'
import { CourseMap } from './components/CourseMap'
import {
  CancellationFeeDetailPage,
  CancellationFeesPage,
  NewCancellationFeePage,
} from './features/cancellation-fees/CancellationFeesPage'
import { BudgetsPage } from './features/golf/BudgetsPage'
import { CaddiesPage } from './features/golf/CaddiesPage'
import { CourseSchedulePage } from './features/golf/CourseSchedulePage'
import { CoursesPage } from './features/golf/CoursesPage'
import { GolfHomePage } from './features/golf/GolfHomePage'
import { MembersPage } from './features/members/MembersPage'
import { PolicyPage } from './features/golf/PolicyPage'
import { ReservationProductsPage } from './features/golf/ReservationProductsPage'
import { SettlementPage } from './features/golf/SettlementPage'
import { SimulatorPage } from './features/golf/SimulatorPage'
import { ShiftBoardPage } from './features/golf/ShiftBoardPage'
import { LedgerPage } from './features/golf/ledger/LedgerPage'
import { ReservationReportImportPage } from './features/golf/reservation-report-import/ReservationReportImportPage'
import { TimelinePage } from './features/golf/timeline/TimelinePage'
import { SettingsAdvancedPage } from './features/settings/SettingsAdvancedPage'
import { CustomerDetailPage } from './features/golf/customers/CustomerDetailPage'
import { CustomersPage } from './features/golf/customers/CustomersPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StaffPage } from './features/staff/StaffPage'
import { useCartUpdates } from './hooks/useCartUpdates'
import { navigate, useRoute } from './lib/router'
import { DownloadPage } from './DownloadPage'
import { PaymentPage } from './PaymentPage'
import { MacOSTabStrip } from './components/MacOSTabStrip'
import { TenantTimezoneProvider } from './context/TenantTimezoneProvider'
import { FeatureFlagProvider } from './feature-flags/FeatureFlags'

const WS_URL = 'ws://127.0.0.1:9001/ws'

export default function App() {
  return (
    <div className="desktop-root">
      <MacOSTabStrip />
      <AppContent />
    </div>
  )
}

function AppContent() {
  const route = useRoute()

  if (route === 'download') return <DownloadPage />

  if (route.startsWith('pay/')) {
    return <PaymentPage token={route.slice('pay/'.length)} />
  }

  const operatorWebUrl = import.meta.env.VITE_COURSEBOARD_OPERATOR_WEB_URL
  if (operatorWebUrl) return <OperatorWebRedirect href={operatorWebUrl} />

  return (
    <AuthProvider>
      <AuthGate>
        <FeatureFlagProvider>
          <TenantTimezoneProvider>
            <AppShell route={route}>
              <RouteContent route={route} />
            </AppShell>
          </TenantTimezoneProvider>
        </FeatureFlagProvider>
      </AuthGate>
    </AuthProvider>
  )
}

function OperatorWebRedirect({ href }: { href: string }) {
  const { t } = useTranslation('nav')
  useEffect(() => {
    window.location.replace(href)
  }, [href])
  return <div className="not-found-page"><p>{t('redirect.message')}</p></div>
}

function RouteContent({ route }: { route: string }) {
  if (route === 'golf') return <GolfHomePage />
  if (route === 'golf/courses') return <CoursesPage />
  if (route.startsWith('golf/courses/')) {
    const segment = decodeRouteSegment(route.slice('golf/courses/'.length).split('/')[0] ?? '')
    if (segment) return <CourseSchedulePage key={segment} courseId={segment} />
  }
  // `golf/products/{serviceId}` opens that service's week; the bare route is the
  // list. `golf/reservation-products` is the older name for the same screens.
  const productsPrefix = ['golf/products', 'golf/reservation-products']
    .find(prefix => route === prefix || route.startsWith(`${prefix}/`))
  if (productsPrefix) {
    const segment = route === productsPrefix
      ? ''
      : decodeRouteSegment(route.slice(productsPrefix.length + 1))
    return <ReservationProductsPage serviceId={segment || undefined} />
  }
  if (route === 'golf/ledger') return <LedgerPage />
  if (route === 'golf/reservation-report-import') return <ReservationReportImportPage />
  if (route === 'golf/timeline') return <TimelinePage />
  if (route === 'golf/caddies/shifts') return <ShiftBoardPage />
  if (route === 'golf/caddies' || route.startsWith('golf/caddies/')) {
    const segment = route === 'golf/caddies'
      ? ''
      : decodeRouteSegment(route.slice('golf/caddies/'.length).split('/')[0] ?? '')
    // Keep a stable key so selecting a caddie (or switching roster/dispatch tabs)
    // updates props instead of remounting and flashing every useResource loader.
    if (segment === 'dispatch' || segment === 'attendance' || segment === 'payroll') {
      return <CaddiesPage key="golf/caddies" initialView={segment} />
    }
    return (
      <CaddiesPage
        key="golf/caddies"
        initialView="roster"
        initialProfileId={segment || undefined}
      />
    )
  }
  if (route === 'staff' || route.startsWith('staff/')) {
    const segment = route === 'staff'
      ? ''
      : decodeRouteSegment(route.slice('staff/'.length).split('/')[0] ?? '')
    // Stable key: opening a person updates props instead of remounting the list.
    return <StaffPage key="staff" staffId={segment || undefined} />
  }
  if (route === 'golf/budgets') return <BudgetsPage />
  if (route === 'golf/policy') return <PolicyPage />
  if (route === 'golf/settlement') return <SettlementPage />
  if (route === 'golf/simulator') return <SimulatorPage />
  if (route === 'cancellation-fees') return <CancellationFeesPage />
  if (route === 'cancellation-fees/new') return <NewCancellationFeePage />
  if (route.startsWith('cancellation-fees/')) {
    return <CancellationFeeDetailPage invoiceId={decodeRouteSegment(route.slice('cancellation-fees/'.length))} />
  }
  if (route === 'course-map') return <CourseMapPage />
  if (route === 'golf/customers') return <CustomersPage />
  if (route.startsWith('golf/customers/')) {
    const segment = decodeRouteSegment(route.slice('golf/customers/'.length).split('/')[0] ?? '')
    if (segment) return <CustomerDetailPage key={segment} customerId={segment} />
  }
  if (route === 'settings') return <SettingsPage />
  if (route === 'settings/advanced') return <SettingsAdvancedPage />
  if (route === 'settings/members') return <MembersPage />
  return <NotFoundPage />
}

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function CourseMapPage() {
  const { t } = useTranslation('map')
  const { carts, status } = useCartUpdates(WS_URL)
  const live = status === 'online' || status === 'mock'
  return (
    <div className="course-map-page">
      <div className="map-toolbar">
        <div>
          <span className={`connection-dot ${live ? 'online' : ''}`} />
          {status === 'online'
            ? t('status.live', { n: String(carts.length) })
            : status === 'mock'
              ? t('status.mock', { n: String(carts.length) })
              : status === 'connecting'
                ? t('status.connecting')
                : t('status.offline')}
        </div>
        <span>{status === 'mock' ? t('source.mock') : t('source.desktop')}</span>
      </div>
      <div className="course-map-stage"><CourseMap carts={carts} /></div>
    </div>
  )
}

function NotFoundPage() {
  const { t } = useTranslation(['nav', 'common'])
  return (
    <div className="not-found-page">
      <MapPin />
      <h1>{t('nav:notFound.title')}</h1>
      <p>{t('nav:notFound.description')}</p>
      <Button type="button" variant="primary" onClick={() => navigate('golf')}>
        <ArrowLeft /> {t('common:action.goHome')}
      </Button>
    </div>
  )
}
