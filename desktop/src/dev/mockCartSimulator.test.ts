import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isMockCartSimulatorEnabled,
  peekMockCarts,
  startMockCartSimulator,
  tickMockCarts,
} from './mockCartSimulator'

describe('mockCartSimulator', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('follows the same enablement gate as Field API fixtures', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', undefined)
    expect(isMockCartSimulatorEnabled()).toBe(true)

    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    expect(isMockCartSimulatorEnabled()).toBe(false)
  })

  it('returns one cart per hole with map coordinates', () => {
    const carts = tickMockCarts(0)
    expect(carts).toHaveLength(18)
    expect(new Set(carts.map(cart => cart.id)).size).toBe(18)
    for (const cart of carts) {
      expect(cart.x).toBeGreaterThanOrEqual(0)
      expect(cart.x).toBeLessThanOrEqual(100)
      expect(cart.y).toBeGreaterThanOrEqual(0)
      expect(cart.y).toBeLessThanOrEqual(100)
      expect(['yellow', 'red', 'blue', 'white', 'green']).toContain(cart.color)
    }
  })

  it('moves carts along their paths over time', () => {
    const a = tickMockCarts(0).find(cart => cart.id === 'cart-01')
    const b = tickMockCarts(12).find(cart => cart.id === 'cart-01')
    expect(a && b).toBeTruthy()
    if (!a || !b) return
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5)
  })

  it('exposes latest carts while running and clears them on stop', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    expect(peekMockCarts()).toBeNull()
    const stop = startMockCartSimulator(() => {})
    expect(frames.length).toBeGreaterThan(0)
    frames[0](16)
    expect(peekMockCarts()?.length).toBe(18)
    stop()
    expect(peekMockCarts()).toBeNull()
  })
})
