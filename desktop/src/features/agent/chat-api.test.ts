import { afterEach, describe, expect, it, vi } from 'vitest'
import { readAgentEvents } from '@tachyon-sdk/agent'
import * as api from '../../api'
import { agentSessionClient, agentStreamBaseUrl, describeOperation, operationRequest, searchOperations, type Catalog, type Operation } from './chat-api'
const operation: Operation = { operationId: 'update_reservation', method: 'PATCH', path: '/v1/course/reservations/{reservation_id}', parameters: [{ name: 'reservation_id', in: 'path' }, { name: 'date', in: 'query', required: true }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Booking' } } } } }
const catalog: Catalog = { operations: [operation], schemas: { Booking: { properties: { name: { type: 'string' } } }, PrivateUnused: {} } }
afterEach(() => vi.restoreAllMocks())
describe('CourseBoard agent tools', () => {
  it('uses the SDK Field paths and application headers for every session request', async () => {
    const json = vi.spyOn(api, 'fieldApiJson').mockResolvedValue({ session_id: 'as_test' })
    const stream = vi.spyOn(api, 'courseboardApiStream').mockResolvedValue(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'))
        controller.close()
      },
    }))
    const client = agentSessionClient()
    const session = await client.createSession()
    for await (const event of client.execute(session, { task: 'read only' })) expect(event.type).toBe('done')
    await client.submitToolResult(session, { tool_id: 'tool', result: '{}', is_error: false })
    expect(json.mock.calls.map(([path]) => path)).toEqual([
      '/v1/field/agent/sessions', '/v1/field/agent/sessions/as_test/tool-result',
    ])
    expect(stream.mock.calls[0][0]).toBe('/v1/field/agent/sessions/as_test/execute')
    for (const [, init] of [...json.mock.calls, ...stream.mock.calls]) {
      expect(init?.headers).toEqual({
        'x-field-agent-app': 'courseboard',
        'x-field-agent-capabilities': 'reservation_status,reservation_status_view',
      })
    }
  })
  it('uses the common Worker by default and supports a paired preview', () => {
    expect(agentStreamBaseUrl('')).toBe('https://field-agent-stream.txcloud.app')
    expect(agentStreamBaseUrl('https://field-agent-stream.txcloud.app/preview/123')).toBe('https://field-agent-stream.txcloud.app/preview/123')
  })
  it('discovers operations and only includes schemas used by that operation', () => {
    expect(searchOperations(catalog, 'reservation').operations).toHaveLength(1)
    expect(searchOperations(catalog, 'unknown').operations).toHaveLength(0)
    expect(Object.keys(describeOperation(catalog, operation.operationId).schemas)).toEqual(['Booking'])
  })
  it('keeps imported report rows out of general reservation searches', () => {
    const data: Catalog = { schemas: {}, operations: [
      { operationId: 'list_report', method: 'GET', path: '/v1/course/reservation-report-entries', summary: 'Imported reservation reports' },
      { operationId: 'get_tee_ledger', method: 'GET', path: '/v1/course/tee-ledger', description: 'Start-time ledger for the requested date' },
    ] }
    expect(searchOperations(data, 'reservation').operations.map(op => op.operationId)).toEqual(['get_tee_ledger'])
    expect(searchOperations(data, 'imported reservation report').operations.map(op => op.operationId)).toContain('list_report')
  })
  it.each(['商品', '商品一覧', '商品を見せて', 'プレー商品', '予約サービス', 'products', 'play plans'])('finds the Products page data for %s', query => {
    const data: Catalog = { schemas: {}, operations: [
      { operationId: 'list_reservation_products', method: 'GET', path: '/v1/course/reservation-products' },
      { operationId: 'list_customers', method: 'GET', path: '/v1/course/customers' },
    ] }
    expect(searchOperations(data, query).operations[0].operationId).toBe('list_reservation_products')
  })
  it('rejects invented operations, paths, extra query keys and path traversal', () => {
    expect(() => describeOperation(catalog, 'delete_everything')).toThrow()
    for (const id of ['../secret', 'x/y', '?foo=1', '']) {
      expect(() => operationRequest(operation, { pathParams: { reservation_id: id }, query: { date: '2026-11-06' } })).toThrow()
    }
    expect(() => operationRequest(operation, { pathParams: { reservation_id: 'res_1' }, query: { date: '2026-11-06', authorization: 'other' } })).toThrow()
    expect(() => operationRequest(operation, { pathParams: { reservation_id: 'res_1' } })).toThrow()
  })
  it('preserves the documented method, parameters and body', () => {
    expect(operationRequest(operation, { pathParams: { reservation_id: 'res_1' }, query: { date: '2026-11-06' }, body: { name: 'test' } })).toEqual({ path: '/v1/course/reservations/res_1?date=2026-11-06', init: { method: 'PATCH', body: '{"name":"test"}' } })
  })
  it('uses the shared SDK to reject truncated streams rather than call them complete', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"say","text":"partial"}\n\n')); controller.close() } })
    const events = readAgentEvents(body)
    expect((await events.next()).value?.text).toBe('partial')
    await expect(events.next()).rejects.toThrow()
  })
})
