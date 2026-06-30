import { describe, expect, it } from 'vitest'
import { normalizeStockLevel } from './stock-level-normalizer'

describe('normalizeStockLevel', () => {
	it('derives missing stock item ids without mock identifiers', () => {
		const item = normalizeStockLevel({
			sku: 'WAN-SKU-001',
			warehouse_name: 'Tokyo DC',
			quantity_on_hand: 12,
			quantity_available: 10,
			quantity_allocated: 2,
			updated_at: '2026-05-29T00:00:00.000Z',
		})

		expect(item?.stockItemId).toBe('sti_wan_sku_001')
		expect(item?.stockItemId).not.toContain('mock')
	})
})
