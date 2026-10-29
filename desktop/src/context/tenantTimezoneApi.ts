import { courseboardApiJson } from '../api'

/** The cache key every reader of the tenant's clock shares. */
export const TENANT_TIMEZONE_CACHE_KEY = 'course:tenant-timezone'

/** The slice of the extension config the clock reads. */
export type TenantTimezoneSettings = {
  configJson?: { timezone?: unknown } | null
}

/**
 * Read the tenant's timezone.
 *
 * `/v1/course/tenant-timezone` is the narrow read every feature may make. The
 * full extension status belongs to the reservation-policy feature and is never
 * asked here, so an operator without that permission is not sent to it.
 */
export async function fetchTenantTimezone(): Promise<TenantTimezoneSettings | null> {
  const response = await courseboardApiJson<{ timezone?: string | null } | null>(
    '/v1/course/tenant-timezone',
  )
  return { configJson: { timezone: response?.timezone ?? null } }
}
