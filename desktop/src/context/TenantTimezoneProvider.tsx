import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { courseboardApiJson } from '../api'
import type { ExtensionStatus } from '../features/golf/models'
import { useResource } from '../hooks/useResource'
import { DEFAULT_TIME_ZONE } from '../lib/clock'
import { isSupportedTimezone } from '../lib/timezone'

const TenantTimezoneContext = createContext(DEFAULT_TIME_ZONE)
const TIMEZONE_CHANGED_EVENT = 'courseboard:tenant-timezone-changed'

function timezoneFromStatus(status: ExtensionStatus | null) {
  const value = status?.configJson?.timezone
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_TIME_ZONE
  }
  const timezone = String(value).trim()
  if (!isSupportedTimezone(timezone)) {
    throw new Error(`Invalid tenant timezone: ${timezone}`)
  }
  return timezone
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

  if (resource.loading && resource.data === null) {
    return <div className="page-loading" aria-busy="true" />
  }
  if (resource.error) throw resource.error

  return (
    <TenantTimezoneContext.Provider value={updatedTimezone ?? timezoneFromStatus(resource.data)}>
      {children}
    </TenantTimezoneContext.Provider>
  )
}

export function useTenantTimezone() {
  return useContext(TenantTimezoneContext)
}

export function notifyTenantTimezoneChanged(timezone: string) {
  window.dispatchEvent(new CustomEvent(TIMEZONE_CHANGED_EVENT, { detail: timezone }))
}
