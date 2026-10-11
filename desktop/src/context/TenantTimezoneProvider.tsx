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
import { useResource } from '../hooks/useResource'
import { DEFAULT_TIME_ZONE } from '../lib/clock'
import { isSupportedTimezone } from '../lib/timezone'

const TenantTimezoneContext = createContext(DEFAULT_TIME_ZONE)
const TIMEZONE_CHANGED_EVENT = 'courseboard:tenant-timezone-changed'

type TenantExtensionSettings = {
  configJson?: { timezone?: unknown } | null
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
  const loader = useMemo(
    () => () => courseboardApiJson<TenantExtensionSettings | null>('/v1/course/extension-status'),
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
