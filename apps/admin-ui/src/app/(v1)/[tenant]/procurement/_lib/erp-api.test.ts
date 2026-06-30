import { describe, expect, it } from 'vitest'
import { normalizeStockLevel } from './stock-level-normalizer'

describe('normalizeStockLevel', () => {
	it('normalizes the tachyon-field-api snake_case stock-level response', () => {
		expect(
			normalizeStockLevel({
				id: 'stl_01test',
				stock_item_id: 'sti_01test',
				sku: 'SKU-001',
				sku_code: 'SKU-001',
				product_name: 'Test product',
				warehouse_id: 'war_01test',
				warehouse_name: 'Tokyo DC',
				quantity_on_hand: 12,
				quantity_available: 10,
				quantity_allocated: 2,
				last_updated_at: '2026-04-28T11:00:00.000Z',
				source_delivery_id: null,
			}),
		).toEqual({
			id: 'stl_01test',
			stockItemId: 'sti_01test',
			skuCode: 'SKU-001',
			productName: 'Test product',
			warehouseId: 'war_01test',
			warehouseName: 'Tokyo DC',
			quantityOnHand: 12,
			quantityAvailable: 10,
			quantityAllocated: 2,
			lastUpdatedAt: '2026-04-28T11:00:00.000Z',
			sourceDeliveryId: null,
		})
	})

	it('falls back on missing optional fields without throwing', () => {
		expect(normalizeStockLevel({ sku_code: 'SKU-002' })).toMatchObject({
			stockItemId: 'sti_sku_002',
			skuCode: 'SKU-002',
			productName: '未設定',
			warehouseName: '未設定',
			quantityOnHand: 0,
			quantityAvailable: 0,
			quantityAllocated: 0,
			sourceDeliveryId: null,
		})
	})
})
