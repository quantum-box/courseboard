import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../api'
import { Notice } from '../components/Page'
import type { ExtensionStatus } from '../features/golf/models'
import { useResource } from '../hooks/useResource'
import { DEFAULT_TIME_ZONE } from '../lib/clock'
import { isSupportedTimezone } from '../lib/timezone'

const TenantTimezoneContext = createContext(DEFAULT_TIME_ZONE)
const TIMEZONE_CHANGED_EVENT = 'courseboard:tenant-timezone-changed'

/**
 * This provider wraps every page, so a failure here decides whether the app
 * renders at all. It used to throw and to withhold children while loading,
 * which turned one unreachable settings endpoint into a blank screen for the
 * whole desk. Fall back to the default zone and say so instead: a ledger
 * showing the wrong offset is recoverable, a ledger that never appears is not.
 */
function resolveTimezone(status: ExtensionStatus | null) {
  const value = status?.configJson?.timezone
  if (value === undefined || value === null || String(value).trim() === '') {
    return { timezone: DEFAULT_TIME_ZONE, rejected: null as string | null }
  }
  const timezone = String(value).trim()
  // An unknown zone is a configuration mistake, not a transient failure, so it
  // gets the same banner rather than a silent substitution.
  if (!isSupportedTimezone(timezone)) {
    return { timezone: DEFAULT_TIME_ZONE, rejected: timezone }
  }
  return { timezone, rejected: null }
}

export function TenantTimezoneProvider({ children }: { children: ReactNode }) {
  const [updatedTimezone, setUpdatedTimezone] = useState<string | null>(null)
  const loader = useMemo(
    () => () => courseboardApiJson<ExtensionStatus | null>('/v1/course/extension-status'),
    [],
  )
  const resource = useResource(loader, [], { cacheKey: 'course:extension-status' })
  useEffect(() => {
    const update = (event: Event) => {
      const timezone = (event as CustomEvent<string>).detail
      if (isSupportedTimezone(timezone)) setUpdatedTimezone(timezone)
    }
    window.addEventListener(TIMEZONE_CHANGED_EVENT, update)
    return () => window.removeEventListener(TIMEZONE_CHANGED_EVENT, update)
  }, [])

  const resolved = resolveTimezone(resource.data)
  const timezone = updatedTimezone ?? resolved.timezone
  // A save on the settings screen is authoritative even if the last fetch
  // failed, so an explicit update clears the banner.
  const fellBack = !updatedTimezone && (Boolean(resource.error) || resolved.rejected !== null)

  return (
    <TenantTimezoneContext.Provider value={timezone}>
      {fellBack ? <TimezoneFallbackNotice timezone={timezone} /> : null}
      {children}
    </TenantTimezoneContext.Provider>
  )
}

function TimezoneFallbackNotice({ timezone }: { timezone: string }) {
  const { t } = useTranslation('common')
  return (
    <div className="page-banner">
      <Notice tone="warning">{t('error.timezoneFallback', { timezone })}</Notice>
    </div>
  )
}

export function useTenantTimezone() {
  return useContext(TenantTimezoneContext)
}

export function notifyTenantTimezoneChanged(timezone: string) {
  window.dispatchEvent(new CustomEvent(TIMEZONE_CHANGED_EVENT, { detail: timezone }))
}
