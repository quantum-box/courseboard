// Only SSE transport lives here. CourseBoard/Field authorize and prepare the
// turn, AIP owns the conversation, and the browser returns authenticated tools.
type Env = { COURSEBOARD_API_ORIGIN: string; AIP_ORIGIN: string }
type Options = { courseboardOrigin: string; aipOrigin: string; fetch?: typeof fetch }
function cors(source?: Headers) {
  const headers = new Headers()
  for (const [key, value] of source ?? []) if (key.toLowerCase().startsWith('access-control-') || key.toLowerCase() === 'vary') headers.set(key, value)
  return headers
}
function error(status: number, message: string, source?: Headers) {
  const headers = cors(source)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify({ message }), { status, headers })
}
export async function handleAgentRequest(request: Request, options: Options): Promise<Response> {
  const call = options.fetch ?? fetch.bind(globalThis)
  const path = new URL(request.url).pathname
  if (path === '/healthz' && ['GET', 'HEAD'].includes(request.method)) return new Response('ok')
  const match = path.match(/^\/v1\/course\/agent\/sessions\/(as_[A-Za-z0-9_-]+)\/execute$/)
  if (!match || match[1].length > 128) return error(404, 'Not found')
  const preparationPath = path.replace(/\/execute$/, '/execute-request')
  if (request.method === 'OPTIONS') {
    const headers = new Headers()
    for (const name of ['origin', 'access-control-request-method', 'access-control-request-headers']) {
      const value = request.headers.get(name); if (value) headers.set(name, value)
    }
    return call(options.courseboardOrigin + preparationPath, { method: 'OPTIONS', headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  }
  if (request.method !== 'POST') return error(405, 'Method not allowed')
  const authorization = request.headers.get('authorization') ?? request.headers.get('x-courseboard-authorization')
  if (!authorization?.startsWith('Bearer ') || !request.headers.get('x-operator-id')) return error(401, 'Authentication and tenant are required')
  const headers = new Headers({ authorization, 'content-type': 'application/json', accept: 'application/json' })
  for (const name of ['x-operator-id', 'x-platform-id', 'origin']) {
    const value = request.headers.get(name); if (value) headers.set(name, value)
  }
  const body = await request.arrayBuffer()
  if (body.byteLength > 100_000) return error(413, 'Request too large')
  let prepared: Response
  try {
    prepared = await call(options.courseboardOrigin + preparationPath, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  } catch { return error(503, 'CourseBoard is unavailable') }
  if (!prepared.ok) return new Response(prepared.body, { status: prepared.status, headers: prepared.headers })
  const output = cors(prepared.headers)
  let execution: unknown
  try { execution = await prepared.json() } catch { return error(503, 'Invalid execution request', output) }
  headers.delete('origin')
  headers.set('accept', 'text/event-stream')
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (request.signal.aborted) abort()
  request.signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 20_000)
  let response: Response
  try {
    response = await call(`${options.aipOrigin}/v1/llms/sessions/${match[1]}/agent/execute`, { method: 'POST', headers, body: JSON.stringify(execution), redirect: 'manual', signal: controller.signal })
  } catch { return error(503, 'Agent runtime is unavailable', output) }
  finally { clearTimeout(timeout) }
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    await response.body?.cancel()
    return error([401, 403].includes(response.status) ? response.status : 503, 'Agent runtime did not return a stream', output)
  }
  output.set('content-type', 'text/event-stream')
  output.set('cache-control', 'no-cache, no-transform')
  output.set('x-accel-buffering', 'no')
  return new Response(response.body, { status: 200, headers: output })
}
export default { fetch(request: Request, env: Env) {
  return handleAgentRequest(request, { courseboardOrigin: env.COURSEBOARD_API_ORIGIN, aipOrigin: env.AIP_ORIGIN })
} }
