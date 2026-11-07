import { describe, expect, it } from 'vitest'
import { readAgentEvents } from '@tachyon-sdk/agent'
import { agentStreamBaseUrl, describeOperation, operationRequest, searchOperations, type Catalog, type Operation } from './chat-api'
const operation: Operation = { operationId: 'update_reservation', method: 'PATCH', path: '/v1/course/reservations/{reservation_id}', parameters: [{ name: 'reservation_id', in: 'path' }, { name: 'date', in: 'query', required: true }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Booking' } } } } }
const catalog: Catalog = { operations: [operation], schemas: { Booking: { properties: { name: { type: 'string' } } }, PrivateUnused: {} } }
describe('CourseBoard agent tools', () => {
  it('uses the edge stream only for the production API', () => {
    expect(agentStreamBaseUrl('https://courseboard-api.txcloud.app', 'https://stream.example')).toBe('https://stream.example')
    expect(agentStreamBaseUrl('http://127.0.0.1:8080', 'https://stream.example')).toBeUndefined()
    expect(agentStreamBaseUrl('https://pr10--courseboard-api.txcloud.app', 'https://stream.example')).toBeUndefined()
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
