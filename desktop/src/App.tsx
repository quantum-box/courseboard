import { Button } from '@tachyon-sdk/native-ui'
import { ArrowLeft, MapPin } from 'lucide-react'
import { useEffect } from 'react'
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
import { CoursesPage } from './features/golf/CoursesPage'
import { GolfHomePage } from './features/golf/GolfHomePage'
import { PolicyPage } from './features/golf/PolicyPage'
import { ReservationProductsPage } from './features/golf/ReservationProductsPage'
import { SettlementPage } from './features/golf/SettlementPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { useCartUpdates } from './hooks/useCartUpdates'
import { navigate, useRoute } from './lib/router'
import { PaymentPage } from './PaymentPage'

const WS_URL = 'ws://127.0.0.1:9001/ws'

export default function App() {
  const route = useRoute()

  if (route.startsWith('pay/')) {
    return <PaymentPage token={route.slice('pay/'.length)} />
  }

  const operatorWebUrl = import.meta.env.VITE_COURSEBOARD_OPERATOR_WEB_URL
  if (operatorWebUrl) return <OperatorWebRedirect href={operatorWebUrl} />

  return (
    <AuthProvider>
      <AuthGate>
        <AppShell route={route}>
          <RouteContent route={route} />
        </AppShell>
      </AuthGate>
    </AuthProvider>
  )
}

function OperatorWebRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href)
  }, [href])
  return <div className="not-found-page"><p>認証済みのCourse Boardへ移動しています…</p></div>
}

function RouteContent({ route }: { route: string }) {
  if (route === 'golf') return <GolfHomePage />
  if (route === 'golf/courses') return <CoursesPage />
  if (route === 'golf/products') return <ReservationProductsPage />
  if (route === 'golf/caddies' || route.startsWith('golf/caddies/')) {
    const segment = route === 'golf/caddies'
      ? ''
      : decodeRouteSegment(route.slice('golf/caddies/'.length).split('/')[0] ?? '')
    if (segment === 'dispatch' || segment === 'attendance' || segment === 'payroll') {
      return <CaddiesPage key={route} initialView={segment} />
    }
    return <CaddiesPage key={route} initialView="roster" initialProfileId={segment || undefined} />
  }
  if (route === 'golf/budgets') return <BudgetsPage />
  if (route === 'golf/policy') return <PolicyPage />
  if (route === 'golf/settlement') return <SettlementPage />
  if (route === 'cancellation-fees') return <CancellationFeesPage />
  if (route === 'cancellation-fees/new') return <NewCancellationFeePage />
  if (route.startsWith('cancellation-fees/')) {
    return <CancellationFeeDetailPage invoiceId={decodeRouteSegment(route.slice('cancellation-fees/'.length))} />
  }
  if (route === 'course-map') return <CourseMapPage />
  if (route === 'settings') return <SettingsPage />
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
  const { carts, status } = useCartUpdates(WS_URL)
  const live = status === 'online' || status === 'mock'
  return (
    <div className="course-map-page">
      <div className="map-toolbar">
        <div>
          <span className={`connection-dot ${live ? 'online' : ''}`} />
          {status === 'online'
            ? `リアルタイム · ${carts.length}台`
            : status === 'mock'
              ? `開発モック · ${carts.length}台`
              : status === 'connecting'
                ? 'シミュレーターへ接続中'
                : 'シミュレーターはオフライン'}
        </div>
        <span>
          {status === 'mock'
            ? 'Browser mock · Tauri WS unavailable'
            : 'Desktop simulator · ws://127.0.0.1:9001'}
        </span>
      </div>
      <div className="course-map-stage"><CourseMap carts={carts} /></div>
    </div>
  )
}

function NotFoundPage() {
  return (
    <div className="not-found-page">
      <MapPin />
      <h1>画面が見つかりません</h1>
      <p>指定された Course Board の画面は移動または削除されています。</p>
      <Button type="button" variant="primary" onClick={() => navigate('golf')}>
        <ArrowLeft /> ホームへ戻る
      </Button>
    </div>
  )
}
