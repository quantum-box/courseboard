/**
 * `Intl.DateTimeFormat` alone is too permissive for configuration: ICU
 * normalises abbreviations (`JST`), legacy links (`Japan`), wrong case, and
 * bare offsets. Prefer the canonical list when the browser exposes it.
 */
const IANA_TIME_ZONES: ReadonlySet<string> | null = (() => {
  const supportedValuesOf = (Intl as {
    supportedValuesOf?: (key: string) => string[]
  }).supportedValuesOf
  if (typeof supportedValuesOf !== 'function') return null
  try {
    const zones = supportedValuesOf('timeZone')
    return new Set([...zones, 'UTC'])
  } catch {
    return null
  }
})()

/** `Region/City`, optionally with one more segment (`America/Indiana/Knox`). */
const IANA_NAME_SHAPE = /^[A-Z][A-Za-z]+(?:\/[A-Z][A-Za-z0-9+_-]*){1,2}$/

export function isSupportedTimezone(value: string) {
  if (IANA_TIME_ZONES) return IANA_TIME_ZONES.has(value)
  if (value !== 'UTC' && !IANA_NAME_SHAPE.test(value)) return false
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone)
  } catch {
    return false
  }
}
