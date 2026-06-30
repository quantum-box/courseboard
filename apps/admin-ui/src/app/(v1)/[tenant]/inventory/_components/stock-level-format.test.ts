import { describe, expect, it } from 'vitest'
import { formatStockLevelDateTime } from './stock-level-format'

describe('formatStockLevelDateTime', () => {
	it('formats valid ISO timestamps for the inventory table', () => {
		expect(formatStockLevelDateTime('2026-04-28T11:00:00.000Z')).toMatch(
			/2026\/04\/28/,
		)
	})

	it('falls back instead of leaking invalid dates into Server Component render', () => {
		expect(formatStockLevelDateTime('not-a-date')).toBe('未設定')
		expect(formatStockLevelDateTime(null)).toBe('未設定')
		expect(formatStockLevelDateTime(undefined)).toBe('未設定')
	})
})
