import type { EffectiveCapabilities } from './EffectiveCapabilitiesProvider'

/** The same cadence as the plan's feature delivery, so a revoked action and a revoked feature close a screen alike. */
export const REFRESH_INTERVAL_MS = 60_000
/** Two refresh periods: one dropped refresh leaves an open form alone, but a decision Field has not reconfirmed for longer closes its screen. */
export const MAX_SNAPSHOT_AGE_MS = 2 * REFRESH_INTERVAL_MS

export const UNAVAILABLE_CAPABILITY_SNAPSHOT = new Error('Capability snapshot is unavailable')

/**
 * Field may have decided at any moment after the request was sent, so a
 * request's answer is good only until two minutes after it was sent. Times are
 * on the monotonic clock, so setting the wall clock back cannot extend a
 * decision.
 */
type Pending = { id: number; expiresAt: number }

/**
 * What the protected screen shows (`phase`) and which request it waits for
 * (`pending`) are separate, so starting a request never changes what is shown.
 * Only an answer, a failure or the age limit does. Loading always has a
 * request that can still answer in time, so it cannot outlast two minutes.
 */
export type CapabilitySnapshot =
  | { phase: 'loading'; pending: Pending }
  | { phase: 'open'; capabilities: EffectiveCapabilities; expiresAt: number; pending: Pending | null }
  | { phase: 'closed'; error: Error; pending: Pending | null }

export type CapabilitySnapshotEvent =
  | { type: 'requested'; id: number; at: number }
  | { type: 'answered'; id: number; at: number; capabilities: EffectiveCapabilities }
  | { type: 'failed'; id: number; at: number; error: Error }
  | { type: 'elapsed'; at: number }

export function firstSnapshot(id: number, at: number): CapabilitySnapshot {
  return { phase: 'loading', pending: { id, expiresAt: at + MAX_SNAPSHOT_AGE_MS } }
}

/**
 * Applied before every event, so a deadline timer that fires late, or an
 * answer that lands before it, can neither keep nor reopen a screen on a
 * decision past its age.
 */
function expire(snapshot: CapabilitySnapshot, at: number): CapabilitySnapshot {
  const pending = snapshot.pending && at < snapshot.pending.expiresAt ? snapshot.pending : null
  switch (snapshot.phase) {
    case 'loading':
      return pending
        ? snapshot
        : { phase: 'closed', error: UNAVAILABLE_CAPABILITY_SNAPSHOT, pending: null }
    case 'open':
      if (at >= snapshot.expiresAt) {
        return { phase: 'closed', error: UNAVAILABLE_CAPABILITY_SNAPSHOT, pending }
      }
      return pending === snapshot.pending ? snapshot : { ...snapshot, pending }
    case 'closed':
      return pending === snapshot.pending ? snapshot : { ...snapshot, pending }
  }
}

export function reduceSnapshot(
  snapshot: CapabilitySnapshot,
  event: CapabilitySnapshotEvent,
): CapabilitySnapshot {
  const current = expire(snapshot, event.at)
  switch (event.type) {
    case 'elapsed':
      return current
    case 'requested':
      return { ...current, pending: { id: event.id, expiresAt: event.at + MAX_SNAPSHOT_AGE_MS } }
    case 'answered':
      if (current.pending?.id !== event.id) return current
      return {
        phase: 'open',
        capabilities: event.capabilities,
        expiresAt: current.pending.expiresAt,
        pending: null,
      }
    case 'failed':
      if (current.pending?.id !== event.id) return current
      // A decision still within its age survives a failed refresh. Without
      // one the screen stays closed behind a retry. It never widens.
      return current.phase === 'open'
        ? { ...current, pending: null }
        : { phase: 'closed', error: event.error, pending: null }
  }
}

export function nextExpiry(snapshot: CapabilitySnapshot) {
  const shown = snapshot.phase === 'open' ? snapshot.expiresAt : Infinity
  const expiresAt = Math.min(shown, snapshot.pending?.expiresAt ?? Infinity)
  return Number.isFinite(expiresAt) ? expiresAt : null
}
