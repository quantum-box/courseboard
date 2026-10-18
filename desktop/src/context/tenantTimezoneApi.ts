import { ApiError, courseboardApiJson } from '../api'

/** The cache key every reader of the tenant's clock shares. */
export const TENANT_TIMEZONE_CACHE_KEY = 'course:tenant-timezone'

/** The slice of the extension config the clock reads. */
export type TenantTimezoneSettings = {
  configJson?: { timezone?: unknown } | null
}

/**
 * Read the tenant's timezone.
 *
 * `/v1/course/tenant-timezone` is the narrow read every feature may make; the
 * full extension status belongs to the reservation-policy feature. Only a 404
 * falls back to the full status: a 403 is indistinguishable from the
 * `ListExtensionStatus` denial both endpoints share, and a denial is not
 * asked twice. (A server older than the endpoint answers 403, so the API
 * has to be deployed before the UI for the clock to read without a warning.)
 */
export async function fetchTenantTimezone(): Promise<TenantTimezoneSettings | null> {
  try {
    const response = await courseboardApiJson<{ timezone?: string | null } | null>(
      '/v1/course/tenant-timezone',
    )
    return { configJson: { timezone: response?.timezone ?? null } }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return courseboardApiJson<TenantTimezoneSettings | null>('/v1/course/extension-status')
    }
    throw error
  }
}
