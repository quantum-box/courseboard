import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api'
import { Notice } from '../components/Page'
import { useResource } from '../hooks/useResource'
import { DEFAULT_TIME_ZONE } from '../lib/clock'
import { isSupportedTimezone } from '../lib/timezone'
import {
  fetchTenantTimezone,
  TENANT_TIMEZONE_CACHE_KEY,
  type TenantTimezoneSettings as TenantExtensionSettings,
} from './tenantTimezoneApi'

const TenantTimezoneContext = createContext(DEFAULT_TIME_ZONE)
const TIMEZONE_CHANGED_EVENT = 'courseboard:tenant-timezone-changed'

async function loadTimezoneSettings() {
  const load = fetchTenantTimezone
  try {
    return await load()
  } catch (error) {
    // Field's cold-start auth gate can time out before a warm retry succeeds.
    // This is a read: retry once for upstream failures, never for denied access.
    if (!(error instanceof ApiError) || ![424, 502, 503, 504].includes(error.status)) throw error
    return load()
  }
}

/** Use the same golf extension setting as the settings screen and API. */
function resolveTimezone(settings: TenantExtensionSettings | null) {
  const value = settings?.configJson?.timezone
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
  const loader = useMemo(() => loadTimezoneSettings, [])
  const resource = useResource(loader, [], { cacheKey: TENANT_TIMEZONE_CACHE_KEY })
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
  // Missing settings use Tokyo normally. A failed read is different: operators
  // without settings permission must not silently get the wrong configured zone.
  // Keep a previously loaded zone during failed background revalidation.
  // A successful settings save takes precedence over the last fetched value.
  const fellBack = !updatedTimezone && (
    resolved.rejected !== null || (resource.error !== null && resource.data === null)
  )

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
