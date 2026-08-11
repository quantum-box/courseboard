import { courseboardApiJson } from '../api'

export type FeatureFlagValue = Readonly<{
  enabled: boolean
  key: string
}>

type EvaluateFeatureFlagsResponse = Readonly<{
  values?: readonly FeatureFlagValue[]
}>

/**
 * Fail-closed merge: every requested key starts disabled, and only an exact
 * `enabled: true` from the API turns it on. Unknown keys returned by the API
 * are ignored.
 */
export function resolveFeatureFlagValues(
  keys: readonly string[],
  values: readonly FeatureFlagValue[] | undefined,
): Readonly<Record<string, boolean>> {
  const resolved: Record<string, boolean> = Object.fromEntries(
    keys.map(key => [key, false]),
  )
  for (const value of values ?? []) {
    if (Object.hasOwn(resolved, value.key) && value.enabled === true) {
      resolved[value.key] = true
    }
  }
  return Object.freeze(resolved)
}

/**
 * Evaluate CourseBoard feature flags through course-api. The SPA never calls
 * the Tachyon platform GraphQL endpoint directly (ADR-0004); course-api
 * proxies `featureFlagValues` for `feature.courseboard.*` keys.
 */
export async function evaluateFeatureFlags(
  keys: readonly string[],
  signal?: AbortSignal,
) {
  const response = await courseboardApiJson<EvaluateFeatureFlagsResponse>(
    '/v1/course/feature-flags/evaluate',
    {
      body: JSON.stringify({ keys }),
      method: 'POST',
      signal,
    },
  )
  return resolveFeatureFlagValues(keys, response?.values)
}
