/**
 * Browser-side GraphQL routing (PLT-2501).
 *
 * Browser urql traffic must NOT hit the public Field API URL
 * (`NEXT_PUBLIC_BACKEND_API_URL`) directly: urql always advertises
 * `Accept: … text/event-stream, multipart/mixed`, and the public txcloud edge
 * in front of the Lambda-backed Field API rejects any request whose Accept
 * includes `text/event-stream` with `501 Origin does not support SSE` —
 * without CORS headers, so the browser surfaces it as
 * `CombinedError: [Network] Failed to fetch`. Every client-side mutation and
 * query through that path fails deterministically.
 *
 * Instead the browser talks to the same-origin proxy route
 * (`/api/graphql`), which forwards to the Field API over the server-side
 * internalService URL — the same stable path SSR reads use (#36).
 */
export const GRAPHQL_PROXY_PATH = '/api/graphql'

/**
 * JSON-only Accept for GraphQL requests. Never includes `text/event-stream`
 * or `multipart/mixed`, so no SSE-guarding edge can reject the request. The
 * Field API only ever responds with JSON here (no subscriptions / @defer).
 */
export const GRAPHQL_JSON_ACCEPT =
	'application/graphql-response+json, application/json'

/**
 * URL for the urql client. On the server (SSR pass of client components)
 * keep the existing server-resolved endpoint; in the browser use the
 * same-origin proxy.
 */
export function resolveUrqlClientUrl(
	serverEndpoint: string,
	isBrowser: boolean,
) {
	if (isBrowser) {
		return GRAPHQL_PROXY_PATH
	}
	return `${serverEndpoint}/v1/graphql`
}
