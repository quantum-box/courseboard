import { describe, expect, it } from 'vitest'

import { normalizeProductTags } from './product-tags-master'

describe('product tags master write-back helpers', () => {
	it('trims tags, drops empty values, and deduplicates in order', () => {
		expect(
			normalizeProductTags([' seasonal ', '', 'vip', 'seasonal', 'vip ']),
		).toEqual(['seasonal', 'vip'])
	})
})
