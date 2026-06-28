import { CollectionConsole } from './CollectionConsole'
import { PaymentPage } from './PaymentPage'
import { CourseMap } from './components/CourseMap'
import { useCartUpdates } from './hooks/useCartUpdates'

const WS_URL = 'ws://127.0.0.1:9001/ws'

export default function App() {
  const route = window.location.hash.replace(/^#\/?/, '')

  if (route.startsWith('pay/')) {
    return <PaymentPage token={route.slice('pay/'.length)} />
  }

  if (route !== 'course-map') {
    return <CollectionConsole />
  }

  return <CourseMapApp />
}

function CourseMapApp() {
  const { carts, status } = useCartUpdates(WS_URL)

  return (
    <div className="app">
      <header className="app-header">
        <h1>Course Board — Course Map</h1>
        <span className="status">
          <span className={`dot ${status === 'online' ? 'online' : ''}`} />
          {status === 'online'
            ? `realtime (${carts.length} carts)`
            : status === 'connecting'
              ? 'connecting…'
              : 'offline'}
        </span>
      </header>
      <CourseMap carts={carts} />
    </div>
  )
}
