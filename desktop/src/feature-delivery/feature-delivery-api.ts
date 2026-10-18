import { ApiError, courseboardApiJson } from '../api'

/** The server's `COURSEBOARD_FEATURE_DELIVERY_ENFORCEMENT`. */
export type DeliveryEnforcement = 'off' | 'shadow' | 'enforce'

export type FeatureDeliveryValue = Readonly<{
  key: string
  enabled: boolean
  resolved: boolean
}>

type EvaluateFeatureDeliveriesResponse = Readonly<{
  enforcement?: unknown
  values?: readonly Partial<FeatureDeliveryValue>[]
}>

export type FeatureDeliveries = Readonly<{
  enforcement: DeliveryEnforcement
  values: Readonly<Record<string, FeatureDeliveryValue>>
}>

/**
 * Anything but a well-formed answer reads as enforced and unresolved: a
 * malformed response must not open a screen the plan leaves out.
 */
export function resolveFeatureDeliveries(
  keys: readonly string[],
  response: EvaluateFeatureDeliveriesResponse | null | undefined,
): FeatureDeliveries {
  const enforcement: DeliveryEnforcement = response?.enforcement === 'off'
    || response?.enforcement === 'shadow'
    || response?.enforcement === 'enforce'
    ? response.enforcement
    : 'enforce'
  const values: Record<string, FeatureDeliveryValue> = {}
  for (const value of response?.values ?? []) {
    if (typeof value.key !== 'string' || !keys.includes(value.key)) continue
    values[value.key] = {
      key: value.key,
      enabled: value.enabled === true,
      resolved: value.resolved === true,
    }
  }
  return Object.freeze({ enforcement, values: Object.freeze(values) })
}

/**
 * A server older than the endpoint cannot enforce anything, so its answer
 * reads as `off`: 403 from the route classifier that refuses unlisted `/v1/`
 * routes, or 404. The endpoint itself never answers 403. Every other failure
 * is left to the caller, which keeps gated screens closed until an answer
 * arrives.
 */
export async function evaluateFeatureDeliveries(keys: readonly string[], signal?: AbortSignal) {
  try {
    const response = await courseboardApiJson<EvaluateFeatureDeliveriesResponse>(
      '/v1/course/feature-deliveries/evaluate',
      { body: JSON.stringify({ keys }), method: 'POST', signal },
    )
    return resolveFeatureDeliveries(keys, response)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return resolveFeatureDeliveries(keys, { enforcement: 'off', values: [] })
    }
    throw error
  }
}
