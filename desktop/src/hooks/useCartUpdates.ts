import { useEffect, useRef, useState } from 'react'
import {
  isMockCartSimulatorEnabled,
  startMockCartSimulator,
} from '../dev/mockCartSimulator'
import type { CartUpdate, CartsMessage } from '../types'

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'mock'

interface UseCartUpdatesResult {
  carts: CartUpdate[]
  status: ConnectionStatus
}

export function useCartUpdates(url: string): UseCartUpdatesResult {
  const [carts, setCarts] = useState<CartUpdate[]>([])
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    isMockCartSimulatorEnabled() ? 'mock' : 'connecting',
  )
  const retryRef = useRef<number | null>(null)

  useEffect(() => {
    // Browser Vite/dev: prefer the stable mock feed. Do not also hammer the
    // Tauri cart WebSocket — failed reconnect loops flip connecting/offline/mock
    // and make the map flicker.
    if (isMockCartSimulatorEnabled()) {
      setStatus('mock')
      return startMockCartSimulator(setCarts)
    }

    let closed = false
    let ws: WebSocket | null = null
    let retryDelay = 500

    function connect() {
      if (closed) return
      setStatus('connecting')
      ws = new WebSocket(url)

      ws.onopen = () => {
        setStatus('online')
        retryDelay = 500
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as CartsMessage
          if (msg.type === 'carts' && Array.isArray(msg.carts)) {
            setCarts(msg.carts)
          }
        } catch {
          // Ignore malformed payloads
        }
      }

      ws.onclose = () => {
        if (closed) return
        setStatus('offline')
        retryRef.current = window.setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 5000)
          connect()
        }, retryDelay)
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      closed = true
      if (retryRef.current) window.clearTimeout(retryRef.current)
      ws?.close()
    }
  }, [url])

  return { carts, status }
}
