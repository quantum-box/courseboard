import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('golf reservation products SSR data source', () => {
	it('uses the runtime-aware server GraphQL client for the product master', () => {
		const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

		expect(source).toContain(
			"import { getServerGraphqlSdk } from 'lib/serverGraphqlClient'",
		)
		expect(source).toContain('getServerGraphqlSdk(session, tenant)')
		expect(source).not.toContain("from 'lib/graphqlClient'")
	})
})
