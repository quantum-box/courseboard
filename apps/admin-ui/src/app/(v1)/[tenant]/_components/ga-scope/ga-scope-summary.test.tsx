import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
	gaExcludedDomains,
	gaIncludedDomains,
	gaScopeShortCopy,
} from './ga-scope-copy'
import { GaScopeSummary } from './ga-scope-summary'

describe('GA scope summary', () => {
	it('renders the PLT-1411 user-facing copy and scope domain groups', () => {
		const html = renderToStaticMarkup(<GaScopeSummary showLongCopy />)

		expect(html).toContain(gaScopeShortCopy)
		for (const item of gaIncludedDomains) {
			expect(html).toContain(item)
		}
		for (const item of gaExcludedDomains) {
			expect(html).toContain(item)
		}
		expect(html).toContain('現時点でGAネイティブ機能の範囲外')
		expect(html).toContain('docs/tasks/plt-1411-ga-scope-exclusions.md')
	})
})
