import { isTauri } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { basePath } from './router'

/** Deploys are infrequent; a few minutes keeps load and battery use low. */
export const NEW_VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000

/** Skip a visibility-triggered check if the last one ran more recently than this. */
const MIN_CHECK_GAP_MS = 60 * 1000

/** A hung request must not leave `checking` stuck true forever. */
export const CHECK_TIMEOUT_MS = 10 * 1000

/**
 * A single differing poll can be a rolling deploy still mid-rollout (some
 * edge nodes already serve the new `index.html`, some don't yet) rather than
 * a settled new version. Requiring two mismatches in a row, with any
 * confirmed-baseline response in between resetting the count, absorbs that.
 */
const REQUIRED_CONSECUTIVE_MISMATCHES = 2

const MODULE_SCRIPT_SRC_PATTERN = /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i

function extractModuleScriptSrc(html: string): string | null {
  return MODULE_SCRIPT_SRC_PATTERN.exec(html)?.[1] ?? null
}

function currentModuleScriptSrc(): string | null {
  return document.querySelector('script[type="module"]')?.getAttribute('src') ?? null
}

/**
 * Tauri and `file://` builds load `index.html` off disk (see `usesHashLocation`
 * in `router.ts`), so re-fetching it tells us nothing, and the desktop app
 * already has its own updater (`scripts/create-updater-manifest.mjs`). Only the
 * browser-served build (Cloudflare Workers / axum) needs this check.
 */
function pollingSupported() {
  return !isTauri() && window.location.protocol !== 'file:'
}

/**
 * True once a poll of `index.html` sees a different entry-script hash than the
 * one this tab loaded with, twice in a row — i.e. a newer build has settled
 * in, not just a rolling deploy mid-flight.
 */
export function useNewVersionAvailable(intervalMs = NEW_VERSION_POLL_INTERVAL_MS) {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (!pollingSupported()) return

    const baseline = currentModuleScriptSrc()
    // Nothing to compare against (e.g. a dev entry rewritten by HMR).
    if (!baseline) return

    let cancelled = false
    let checking = false
    let detected = false
    let lastCheckedAt = 0
    let consecutiveMismatches = 0
    let inFlight: AbortController | null = null

    const check = async () => {
      if (cancelled || checking || detected) return
      checking = true
      lastCheckedAt = Date.now()
      const controller = new AbortController()
      inFlight = controller
      const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
      try {
        const response = await fetch(basePath(), { cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const latest = extractModuleScriptSrc(await response.text())
        if (!latest) {
          // Could not find an entry script in the response; inconclusive.
        } else if (latest === baseline) {
          consecutiveMismatches = 0
        } else {
          consecutiveMismatches += 1
          if (consecutiveMismatches >= REQUIRED_CONSECUTIVE_MISMATCHES) {
            detected = true
            if (!cancelled) setAvailable(true)
          }
        }
      } catch {
        // A transient network hiccup or an aborted/timed-out request is not
        // "a new version"; try again next tick.
      } finally {
        clearTimeout(timeout)
        if (inFlight === controller) inFlight = null
        checking = false
      }
    }

    const interval = setInterval(() => { void check() }, intervalMs)
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastCheckedAt < MIN_CHECK_GAP_MS) return
      void check()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      inFlight?.abort()
    }
  }, [intervalMs])

  return available
}
