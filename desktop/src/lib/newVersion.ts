import { isTauri } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { basePath } from './router'

/** Deploys are infrequent; a few minutes keeps load and battery use low. */
export const NEW_VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000

/** Skip a visibility-triggered check if the last one ran more recently than this. */
const MIN_CHECK_GAP_MS = 60 * 1000

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
 * one this tab loaded with — i.e. a newer build has been deployed.
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

    const check = async () => {
      if (cancelled || checking || detected) return
      checking = true
      lastCheckedAt = Date.now()
      try {
        const response = await fetch(basePath(), { cache: 'no-store' })
        if (!response.ok) return
        const latest = extractModuleScriptSrc(await response.text())
        if (latest && latest !== baseline) {
          detected = true
          if (!cancelled) setAvailable(true)
        }
      } catch {
        // A transient network hiccup is not "a new version"; try again later.
      } finally {
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
    }
  }, [intervalMs])

  return available
}
