import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * PLT-2501 regression guard.
 *
 * The deleteProduct server action must use the server-resolved SDK
 * (`getServerGraphqlSdk`, internalService URL). Using the client-facing
 * `getGraphqlSdk` resolves the public Field API URL from process.env, which
 * is not the internalService value in the worker runtime, so the delete
 * mutation silently no-ops (the product remained in the master after
 * pressing 「削除する」).
 */
describe('deleteProduct server action uses the server-resolved Field API SDK', () => {
	it('uses getServerGraphqlSdk, not the client getGraphqlSdk', () => {
		const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
		expect(source).toContain('getServerGraphqlSdk(')
		expect(source).not.toMatch(/\bgetGraphqlSdk\s*\(/)
		expect(source).not.toContain("from 'lib/graphqlClient'")
	})
})
