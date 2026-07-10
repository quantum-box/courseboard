import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * PLT-2501 regression guard.
 *
 * Server components that fetch Field API data during SSR must use the
 * server-resolved SDK (`getServerGraphqlSdk`, internalService URL). The
 * client-facing `getGraphqlSdk` resolves the public Field API URL, which is
 * not reliably reachable from worker subrequests — the failure is then
 * swallowed and renders as an empty list / 404, indistinguishable from
 * "no data" (exactly how the products master showed empty while the products
 * existed in the DB).
 */
const FILES = [
	'_components/products-list.tsx',
	'[id]/page.tsx',
]

describe('library/products SSR uses the server-resolved Field API SDK', () => {
	for (const file of FILES) {
		it(`${file} uses getServerGraphqlSdk, not the client getGraphqlSdk`, () => {
			const source = readFileSync(join(__dirname, file), 'utf8')
			expect(source).toContain('getServerGraphqlSdk(')
			// No call to the client-facing SDK and no import from graphqlClient
			// (comments may still mention the name).
			expect(source).not.toMatch(/\bgetGraphqlSdk\s*\(/)
			expect(source).not.toContain("from 'lib/graphqlClient'")
		})
	}
})
