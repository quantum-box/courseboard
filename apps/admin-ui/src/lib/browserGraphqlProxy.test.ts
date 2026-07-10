import { describe, expect, it } from 'vitest'
import {
	GRAPHQL_JSON_ACCEPT,
	GRAPHQL_PROXY_PATH,
	resolveUrqlClientUrl,
} from './browserGraphqlProxy'

describe('browser GraphQL routing (PLT-2501)', () => {
	it('routes the browser through the same-origin proxy, never the public Field API URL', () => {
		expect(
			resolveUrqlClientUrl('https://tachyon-field-api.txcloud.app', true),
		).toBe(GRAPHQL_PROXY_PATH)
	})

	it('keeps the server-resolved endpoint during SSR', () => {
		expect(
			resolveUrqlClientUrl('https://field-api.internal.example', false),
		).toBe('https://field-api.internal.example/v1/graphql')
	})

	it('the JSON accept never advertises SSE or multipart (rejected by the public edge with 501)', () => {
		expect(GRAPHQL_JSON_ACCEPT).not.toContain('text/event-stream')
		expect(GRAPHQL_JSON_ACCEPT).not.toContain('multipart/mixed')
		expect(GRAPHQL_JSON_ACCEPT).toContain('application/json')
	})
})
