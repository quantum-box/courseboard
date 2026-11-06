import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAgentRequest } from './worker.ts'
const options = { courseboardOrigin: 'https://course.test', aipOrigin: 'https://aip.test' }
const request = (body = '{}') => new Request('https://stream.test/v1/course/agent/sessions/as_test/execute', {
  method: 'POST', headers: { authorization: 'Bearer user-token', 'x-operator-id': 'tn_test', 'x-platform-id': 'tn_platform', origin: 'https://courseboard.test' }, body,
})

test('health and rejected routes never call upstream', async () => {
  let calls = 0
  const fetch = async () => { calls++; throw new Error('Unexpected call') }
  assert.equal((await handleAgentRequest(new Request('https://stream.test/healthz'), { ...options, fetch })).status, 200)
  assert.equal((await handleAgentRequest(new Request('https://stream.test/admin'), { ...options, fetch })).status, 404)
  assert.equal((await handleAgentRequest(new Request('https://stream.test/v1/course/agent/sessions/as_test/execute', { method: 'POST' }), { ...options, fetch })).status, 401)
  assert.equal(calls, 0)
})
test('passes CORS preflight to the protected CourseBoard preparation endpoint', async () => {
  const response = await handleAgentRequest(new Request('https://stream.test/v1/course/agent/sessions/as_test/execute', { method: 'OPTIONS', headers: { origin: 'https://courseboard.test', 'access-control-request-method': 'POST' } }), {
    ...options, fetch: async (url, init) => {
      assert.equal(url, 'https://course.test/v1/course/agent/sessions/as_test/execute-request')
      assert.equal(init?.method, 'OPTIONS')
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': 'https://courseboard.test' } })
    },
  })
  assert.equal(response.status, 204)
})
test('upstream authorization failure prevents agent execution', async () => {
  let calls = 0
  const response = await handleAgentRequest(request(), { ...options, fetch: async () => { calls++; return new Response('denied', { status: 403 }) } })
  assert.equal(response.status, 403)
  assert.equal(calls, 1)
})
test('streams without buffering and uses only the server-prepared model with caller identity', async () => {
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const paths: string[] = []
  const response = await handleAgentRequest(request('{"task":"read","model":"untrusted"}'), {
    ...options, fetch: async (url, init) => {
      paths.push(String(url))
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('authorization'), 'Bearer user-token')
      assert.equal(headers.get('x-operator-id'), 'tn_test')
      assert.equal(headers.get('x-platform-id'), 'tn_platform')
      if (paths.length === 1) {
        assert.equal(headers.get('origin'), 'https://courseboard.test')
        return Response.json({ task: 'read', model: 'server-model', client_tools: [] }, { headers: { 'access-control-allow-origin': 'https://courseboard.test' } })
      }
      assert.equal(url, 'https://aip.test/v1/llms/sessions/as_test/agent/execute')
      assert.equal(headers.get('origin'), null)
      assert.equal(JSON.parse(String(init?.body)).model, 'server-model')
      return new Response(stream.readable, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://courseboard.test')
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform')
  const reader = response.body!.getReader()
  const writing = writer.write(new TextEncoder().encode('data: {"type":"say","text":"hello"}\n\n'))
  const first = await reader.read()
  assert.equal(first.done, false)
  assert.match(new TextDecoder().decode(first.value), /hello/)
  await writing
  await writer.close()
  assert.equal((await reader.read()).done, true)
})
test('rejects oversized input before making an authenticated request', async () => {
  const response = await handleAgentRequest(request('x'.repeat(100_001)), { ...options, fetch: async () => { throw new Error('Unexpected upstream') } })
  assert.equal(response.status, 413)
})
