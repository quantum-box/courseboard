import { courseboardApiJson } from '../api'

export type FeatureFlagValue = Readonly<{
  enabled: boolean
  key: string
}>

type EvaluateFeatureFlagsResponse = Readonly<{
  values?: readonly FeatureFlagValue[]
}>

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
  return resolveFeatureFlagValues(keys, response.values)
}
