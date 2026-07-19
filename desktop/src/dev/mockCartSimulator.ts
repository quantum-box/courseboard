/**
 * Browser-side cart position simulator for Vite development.
 *
 * The real cart feed is the Tauri desktop WebSocket on ws://127.0.0.1:9001.
 * When that listener is unavailable (plain `npm run dev`), this mirror keeps
 * the course map browsable with moving carts.
 *
 * Gated by the same flag as Field API fixtures (`isMockFieldDataEnabled`).
 */
import type { CartColor, CartUpdate } from '../types'
import { isMockFieldDataEnabled } from './mockFieldApi'

export function isMockCartSimulatorEnabled() {
  return isMockFieldDataEnabled()
}

type Point = readonly [number, number]

type Runner = {
  id: string
  caddieNumber: number
  color: CartColor
  holeIdx: number
  phase: number
  travelSec: number
}

/** Simplified centerlines from `desktop/src-tauri/src/cart_simulator.rs`. */
const HOLE_PATHS: Point[][] = [
  [[32, 55], [33, 49], [33.5, 43], [34, 37], [34, 32]],
  [[32, 62], [31.5, 56], [31, 50], [30, 47]],
  [[62, 75], [67, 71], [73, 67], [78, 64]],
  [[78, 42], [80, 36], [82, 30], [84, 27]],
  [[72, 40], [73, 32], [75, 27], [76, 25]],
  [[62, 60], [65, 54], [69, 50], [74, 47]],
  [[56, 55], [58.5, 49], [62, 45], [66, 42]],
  [[52, 42], [50.5, 36], [52, 30]],
  [[50, 67], [48, 61], [45.5, 55], [44, 53]],
  [[20, 50], [15, 44], [10, 37], [8, 32]],
  [[5, 16], [13, 11], [22, 6.5], [30, 5]],
  [[45, 25], [53, 18], [62, 12], [72, 8]],
  [[62, 28], [68, 22], [74, 18], [78, 17]],
  [[40, 27], [46, 21], [50, 18.5], [54, 17]],
  [[32, 30], [33.5, 24], [35.5, 19], [38, 17]],
  [[52, 27], [49.5, 21], [46.5, 16], [44, 13]],
  [[43, 23], [39, 17], [35, 12], [32, 8]],
  [[22, 60], [22, 54], [21, 48], [20, 40]],
]

const RUNNERS: Runner[] = [
  { id: 'cart-01', caddieNumber: 82, color: 'yellow', holeIdx: 0, phase: 0.1, travelSec: 42 },
  { id: 'cart-02', caddieNumber: 95, color: 'yellow', holeIdx: 1, phase: 0.55, travelSec: 32 },
  { id: 'cart-03', caddieNumber: 101, color: 'white', holeIdx: 2, phase: 0.2, travelSec: 36 },
  { id: 'cart-04', caddieNumber: 115, color: 'blue', holeIdx: 3, phase: 0.7, travelSec: 26 },
  { id: 'cart-05', caddieNumber: 46, color: 'yellow', holeIdx: 4, phase: 0.35, travelSec: 22 },
  { id: 'cart-06', caddieNumber: 108, color: 'blue', holeIdx: 5, phase: 0.05, travelSec: 32 },
  { id: 'cart-07', caddieNumber: 100, color: 'yellow', holeIdx: 6, phase: 0.6, travelSec: 28 },
  { id: 'cart-08', caddieNumber: 31, color: 'red', holeIdx: 7, phase: 0.45, travelSec: 18 },
  { id: 'cart-09', caddieNumber: 42, color: 'yellow', holeIdx: 8, phase: 0.8, travelSec: 28 },
  { id: 'cart-10', caddieNumber: 94, color: 'white', holeIdx: 9, phase: 0.15, travelSec: 32 },
  { id: 'cart-11', caddieNumber: 77, color: 'yellow', holeIdx: 10, phase: 0.4, travelSec: 40 },
  { id: 'cart-12', caddieNumber: 88, color: 'blue', holeIdx: 11, phase: 0.25, travelSec: 44 },
  { id: 'cart-13', caddieNumber: 63, color: 'yellow', holeIdx: 12, phase: 0.65, travelSec: 30 },
  { id: 'cart-14', caddieNumber: 51, color: 'white', holeIdx: 13, phase: 0.5, travelSec: 28 },
  { id: 'cart-15', caddieNumber: 29, color: 'red', holeIdx: 14, phase: 0.3, travelSec: 20 },
  { id: 'cart-16', caddieNumber: 70, color: 'yellow', holeIdx: 15, phase: 0.75, travelSec: 26 },
  { id: 'cart-17', caddieNumber: 58, color: 'blue', holeIdx: 16, phase: 0.12, travelSec: 30 },
  { id: 'cart-18', caddieNumber: 41, color: 'yellow', holeIdx: 17, phase: 0.48, travelSec: 36 },
]

function samplePolyline(path: Point[], t: number): { x: number; y: number; heading: number } {
  if (path.length === 0) return { x: 0, y: 0, heading: 0 }
  if (path.length === 1) return { x: path[0][0], y: path[0][1], heading: 0 }

  let total = 0
  const segments: number[] = []
  for (let i = 0; i < path.length - 1; i += 1) {
    const dx = path[i + 1][0] - path[i][0]
    const dy = path[i + 1][1] - path[i][1]
    const len = Math.hypot(dx, dy)
    segments.push(len)
    total += len
  }
  if (total <= 0) return { x: path[0][0], y: path[0][1], heading: 0 }

  let dist = Math.min(1, Math.max(0, t)) * total
  for (let i = 0; i < segments.length; i += 1) {
    const len = segments[i]
    if (dist > len && i < segments.length - 1) {
      dist -= len
      continue
    }
    const ratio = len > 0 ? dist / len : 0
    const [x0, y0] = path[i]
    const [x1, y1] = path[i + 1]
    return {
      x: x0 + (x1 - x0) * ratio,
      y: y0 + (y1 - y0) * ratio,
      heading: Math.atan2(y1 - y0, x1 - x0),
    }
  }
  const last = path[path.length - 1]
  return { x: last[0], y: last[1], heading: 0 }
}

/** Pure tick used by the live mock loop and unit tests. */
export function tickMockCarts(elapsedSec: number): CartUpdate[] {
  return RUNNERS.map(runner => {
    const path = HOLE_PATHS[runner.holeIdx] ?? HOLE_PATHS[0]
    const fullCycle = runner.travelSec * 2
    let local = ((elapsedSec / fullCycle) + runner.phase) % 1
    if (local < 0) local += 1
    const t = local < 0.5 ? local * 2 : (1 - local) * 2
    const sample = samplePolyline(path, t)
    const heading = local < 0.5 ? sample.heading : sample.heading + Math.PI
    return {
      id: runner.id,
      x: sample.x,
      y: sample.y,
      heading,
      color: runner.color,
      caddieNumber: runner.caddieNumber,
    }
  })
}

/** Latest mock positions for the map rAF loop (null when simulator is stopped). */
let latestMockCarts: CartUpdate[] | null = null

export function peekMockCarts(): CartUpdate[] | null {
  return latestMockCarts
}

/**
 * Start a smooth mock feed via rAF. Returns a stop function.
 * Prefer the live Tauri WebSocket when mock data is disabled.
 *
 * Positions update every frame via `peekMockCarts()`; React `onTick` is
 * throttled so the toolbar does not re-render at display refresh rate.
 */
export function startMockCartSimulator(
  onTick: (carts: CartUpdate[]) => void,
): () => void {
  const startedAt = performance.now()
  let rafId = 0
  let lastPush = 0
  let running = true
  const PUSH_MS = 250

  const loop = (now: number) => {
    if (!running) return
    const elapsedSec = (now - startedAt) / 1000
    latestMockCarts = tickMockCarts(elapsedSec)
    if (now - lastPush >= PUSH_MS || lastPush === 0) {
      lastPush = now
      onTick(latestMockCarts)
    }
    rafId = globalThis.requestAnimationFrame(loop)
  }
  rafId = globalThis.requestAnimationFrame(loop)
  return () => {
    running = false
    globalThis.cancelAnimationFrame(rafId)
    latestMockCarts = null
  }
}
