import { TachyonAgentSessionClient, type AgentSessionEvent } from '@tachyon-sdk/agent'
import { courseboardApiJson, courseboardApiStream, fieldApiJson, operatorApiBaseUrl } from '../../api'
import { isMockFieldDataEnabled } from '../../dev/mockFieldApi'
import { i18next } from '../../i18n'
import { reservationStatusFromLedger } from './reservation-status'
import type { TeeLedgerResponse } from '../golf/ledger/models'

const ROOT = '/v1/course/agent'
const LEGACY_STREAM = 'https://courseboard-agent-stream.txcloud.app'
const isLegacyStream = (stream?: string) => stream?.trim().replace(/\/$/, '') === LEGACY_STREAM
/** The legacy host remains selectable during rollout and rollback. */
export function agentStreamBaseUrl(base = operatorApiBaseUrl(), stream = import.meta.env.VITE_COURSEBOARD_AGENT_STREAM_BASE_URL) {
  if (isLegacyStream(stream) && base.replace(/\/$/, '') !== 'https://courseboard-api.txcloud.app') return undefined
  return stream?.trim() || 'https://field-agent-stream.txcloud.app'
}
export function usesSharedAgent() {
  return !isLegacyStream(import.meta.env.VITE_COURSEBOARD_AGENT_STREAM_BASE_URL)
}
// The released SDK already supports custom transports. These are the Field
// application headers also exported by the additive SDK 0.5 release.
export const sharedAgentHeaders = () => ({
  'x-field-agent-app': 'courseboard',
  'x-field-agent-capabilities': 'reservation_status,reservation_status_view',
})
export type Operation = { operationId: string; method: string; path: string; summary?: string | null; description?: string | null; parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[] | null; requestBody?: unknown }
export type Catalog = { operations: Operation[]; schemas: Record<string, unknown> }
export type ToolArgs = { date?: string; golfCourseIds?: string[]; operationId?: string; query?: Record<string, unknown> | string; pathParams?: Record<string, unknown>; body?: unknown; confirmation?: string }
export type FieldContext = { described?: Record<string, { method: string; path: string; summary?: string }>; [key: string]: unknown }

export function agentSessionClient() {
  const shared = usesSharedAgent()
  const root = shared ? '/v1/field/agent' : ROOT
  return new TachyonAgentSessionClient({
    paths: {
      sessions: `${root}/sessions`, execute: id => `${root}/sessions/${encodeURIComponent(id)}/execute`,
      toolResult: id => `${root}/sessions/${encodeURIComponent(id)}/tool-result`,
    },
    transport: {
      postJson: (path, body, signal) => (shared ? fieldApiJson : courseboardApiJson)(path, {
        method: 'POST', body: JSON.stringify(body ?? {}), signal, headers: shared ? sharedAgentHeaders() : undefined,
      }),
      postStream: (path, body, signal) => courseboardApiStream(path, {
        method: 'POST', body: JSON.stringify(body), signal, headers: shared ? sharedAgentHeaders() : undefined,
      }, agentStreamBaseUrl()),
    },
  })
}

export async function loadCatalog(signal: AbortSignal): Promise<Catalog> {
  const value = await courseboardApiJson<Catalog>(`${ROOT}/operations`, { signal })
  if (!value || !Array.isArray(value.operations) || !value.schemas || value.operations.some(op =>
    !op || typeof op.operationId !== 'string' || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(op.method)
    || !op.path.startsWith('/v1/course/') || op.path.startsWith(`${ROOT}/`))) throw new Error('Invalid operation catalogue')
  return value
}
export function toolArgs(raw: unknown): ToolArgs {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool arguments')
  return value as ToolArgs
}
export function searchOperations(catalog: Catalog, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const explicitlyImported = /import|取り込|取込|report[- ]entries/i.test(query)
  const scored = catalog.operations.filter(op => explicitlyImported || op.path !== '/v1/course/reservation-report-entries').map(op => {
    const purpose = ['/v1/course/tee-ledger', '/v1/course/tee-sheet'].includes(op.path)
      ? 'reservation reservations booking bookings daily status 予約 予約状況 予約台帳' : ''
    const text = `${purpose} ${op.operationId} ${op.path} ${op.summary ?? ''} ${op.description ?? ''}`.toLowerCase()
    return { op, score: words.filter(word => text.includes(word)).length }
  }).filter(item => item.score || !words.length).sort((a, b) => b.score - a.score)
  return { operations: scored.slice(0, 20).map(({ op }) => ({ operationId: op.operationId, method: op.method, path: op.path, summary: op.summary ?? op.description })), matched: scored.length }
}
export function describeOperation(catalog: Catalog, id: string) {
  const operation = catalog.operations.find(op => op.operationId === id)
  if (!operation) throw new Error('Unknown CourseBoard operation')
  const schemas: Record<string, unknown> = {}
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return
    const ref = (value as Record<string, unknown>).$ref
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
      const key = ref.slice('#/components/schemas/'.length)
      if (!(key in schemas) && key in catalog.schemas) { schemas[key] = catalog.schemas[key]; visit(schemas[key]) }
    }
    Object.values(value).forEach(visit)
  }
  visit(operation)
  return { operation, schemas }
}
export function operationRequest(operation: Operation, args: ToolArgs) {
  if (!operation.path.startsWith('/v1/course/') || operation.path.startsWith(`${ROOT}/`) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(operation.method)) throw new Error('Invalid operation')
  const pathKeys = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1])
  const params = args.pathParams ?? {}
  if (Object.keys(params).some(key => !pathKeys.includes(key))) throw new Error('Unknown path parameter')
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params[key]
    if ((typeof value !== 'string' && typeof value !== 'number') || !String(value) || /[\\/?#]/.test(String(value)) || ['.', '..'].includes(String(value))) throw new Error('Invalid path parameter')
    return encodeURIComponent(String(value))
  })
  const query = new URLSearchParams()
  const input = args.query ?? {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid query')
  const allowed = (operation.parameters ?? []).filter(p => p.in === 'query')
  for (const [key, raw] of Object.entries(input)) {
    if (!allowed.some(p => p.name === key)) throw new Error('Unknown query parameter')
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Invalid query value')
      query.append(key, String(value))
    }
  }
  if (allowed.some(p => p.required && !query.has(p.name))) throw new Error('Missing query parameter')
  return { path: `${path}${query.size ? `?${query}` : ''}`, init: { method: operation.method, ...(operation.method !== 'GET' && args.body !== undefined ? { body: JSON.stringify(args.body) } : {}) } }
}
export async function executeOperation(operation: Operation, args: ToolArgs, signal: AbortSignal) {
  const request = operationRequest(operation, args)
  const result = await courseboardApiJson(request.path, { ...request.init, signal })
  if (operation.method === 'GET' && operation.path === '/v1/course/tee-ledger') {
    const query = new URL(request.path, 'https://courseboard.invalid').searchParams
    const courseIds = [query.get('golfCourseIds'), query.get('golfCourseId')].filter(Boolean).flatMap(ids => ids!.split(','))
    return reservationStatusFromLedger(result as TeeLedgerResponse, query.get('date') ?? '', courseIds)
  }
  if (operation.path === '/v1/course/reservation-report-entries') {
    return { source: operation.path, scope: 'imported reservation report rows only', authoritativeForReservationCounts: false, guidance: 'Empty imported report rows do not mean zero live reservations. Use courseboard_get_reservation_status for reservation counts.', data: result }
  }
  return result
}
export async function callFieldTool(session: string, tool_id: string, tool_name: string, args: ToolArgs, context: FieldContext, signal: AbortSignal) {
  const shared = usesSharedAgent()
  return (shared ? fieldApiJson : courseboardApiJson)<{ context: FieldContext; event: AgentSessionEvent }>(`${shared ? '/v1/field/agent' : ROOT}/sessions/${encodeURIComponent(session)}/tool-call`, {
    method: 'POST', body: JSON.stringify({ tool_id, tool_name, args, context }), signal,
    headers: shared ? sharedAgentHeaders() : undefined,
  })
}

export const isAgentDemo = isMockFieldDataEnabled
/** Explicit UI demo, never represented as a live AI or a business update. */
export async function* demoEvents(signal: AbortSignal): AsyncGenerator<AgentSessionEvent> {
  signal.throwIfAborted()
  yield { type: 'say', text: i18next.t('agent:chat.demoReply') }
  yield { type: 'done' }
}
