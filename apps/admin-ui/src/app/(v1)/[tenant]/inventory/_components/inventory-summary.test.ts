import { describe, expect, it } from 'vitest'
import {
	filterStockLevelsForOperator,
	getStockLevelOperatorState,
	normalizeStockLevelFilterState,
	summarizeInventoryForOperator,
} from './inventory-summary'
import type { StockLevel } from '../../procurement/_lib/stock-level-normalizer'

const stockLevel = (overrides: Partial<StockLevel>): StockLevel => ({
	id: 'sl_1',
	stockItemId: 'si_1',
	skuCode: 'SKU-1',
	productName: 'Item 1',
	warehouseId: 'wh_1',
	warehouseName: 'Main',
	quantityOnHand: 10,
	quantityAvailable: 8,
	quantityAllocated: 2,
	lastUpdatedAt: '2026-05-20T01:00:00.000Z',
	sourceDeliveryId: null,
	...overrides,
})

describe('summarizeInventoryForOperator', () => {
	it('summarizes stock, low stock, and location state for the operator overview', () => {
		const summary = summarizeInventoryForOperator({
			stockLevels: [
				{
					id: 'sl_1',
					stockItemId: 'si_1',
					skuCode: 'SKU-1',
					productName: 'Item 1',
					warehouseId: 'wh_1',
					warehouseName: 'Main',
					quantityOnHand: 10,
					quantityAvailable: 8,
					quantityAllocated: 2,
					lastUpdatedAt: '2026-05-20T01:00:00.000Z',
					sourceDeliveryId: null,
				},
				{
					id: 'sl_2',
					stockItemId: 'si_2',
					skuCode: 'SKU-2',
					productName: 'Item 2',
					warehouseId: 'wh_1',
					warehouseName: 'Main',
					quantityOnHand: 0,
					quantityAvailable: -1,
					quantityAllocated: 1,
					lastUpdatedAt: '2026-05-21T01:00:00.000Z',
					sourceDeliveryId: 'del_1',
				},
			],
			lowStockAlerts: [
				{
					stockItemId: 'si_1',
					stockLevelId: 'sl_1',
					skuCode: 'SKU-1',
					productName: 'Item 1',
					warehouseId: 'wh_1',
					warehouseName: 'Main',
					quantityOnHand: 10,
					safetyStockQuantity: 12,
					reorderPointQuantity: 10,
					replenishmentTargetQuantity: 20,
					preferredOrderQuantity: null,
					recommendedOrderQuantity: 10,
					shortageQuantity: 2,
					decisionStatus: 'pending',
					decisionNote: null,
					decidedAt: null,
					decidedBy: null,
					updatedAt: '2026-05-21T01:00:00.000Z',
				},
			],
			locations: [
				{
					id: 'loc_1',
					kind: 'warehouse',
					referenceId: 'wh_1',
					name: 'Main',
					stockHolding: true,
					createdAt: '2026-05-01T01:00:00.000Z',
					updatedAt: '2026-05-01T01:00:00.000Z',
				},
				{
					id: 'loc_2',
					kind: 'store',
					referenceId: 'st_1',
					name: 'Store',
					stockHolding: true,
					createdAt: '2026-05-01T01:00:00.000Z',
					updatedAt: '2026-05-01T01:00:00.000Z',
				},
			],
		})

		expect(summary.stockLevelCount).toBe(2)
		expect(summary.warehouseCount).toBe(1)
		expect(summary.storeCount).toBe(1)
		expect(summary.totalOnHand).toBe(10)
		expect(summary.totalAvailable).toBe(7)
		expect(summary.totalAllocated).toBe(3)
		expect(summary.negativeAvailableCount).toBe(1)
		expect(summary.pendingLowStockCount).toBe(1)
		expect(summary.lastUpdatedAt).toBe('2026-05-21T01:00:00.000Z')
	})
})

describe('getStockLevelOperatorState', () => {
	it('prioritizes negative availability before stockout and allocation labels', () => {
		expect(
			getStockLevelOperatorState({
				id: 'sl',
				stockItemId: 'si',
				skuCode: 'SKU',
				productName: 'Item',
				warehouseName: 'Main',
				quantityOnHand: 0,
				quantityAvailable: -1,
				quantityAllocated: 1,
				lastUpdatedAt: '2026-05-21T01:00:00.000Z',
				sourceDeliveryId: null,
			}).label,
		).toBe('要確認')

		expect(
			getStockLevelOperatorState(
				stockLevel({
					quantityAllocated: 0,
					sourceDeliveryId: 'del_1',
				}),
			).label,
		).toBe('入荷反映あり')
		expect(getStockLevelOperatorState(stockLevel({}), true).label).toBe(
			'低在庫',
		)
	})
})

describe('normalizeStockLevelFilterState', () => {
	it('keeps known operator states and falls back to all', () => {
		expect(normalizeStockLevelFilterState('attention')).toBe('attention')
		expect(normalizeStockLevelFilterState('low_stock')).toBe('low_stock')
		expect(normalizeStockLevelFilterState('reorder_needed')).toBe(
			'reorder_needed',
		)
		expect(normalizeStockLevelFilterState('receiving_linked')).toBe(
			'receiving_linked',
		)
		expect(normalizeStockLevelFilterState('unknown')).toBe('all')
		expect(normalizeStockLevelFilterState(undefined)).toBe('all')
	})
})

describe('filterStockLevelsForOperator', () => {
	const items = [
		stockLevel({
			id: 'sl_negative',
			skuCode: 'NEG-1',
			productName: 'Negative Item',
			quantityAvailable: -1,
			quantityAllocated: 1,
			warehouseId: 'wh_main',
			warehouseName: 'Main Warehouse',
		}),
		stockLevel({
			id: 'sl_stockout',
			skuCode: 'OUT-1',
			productName: 'Stockout Item',
			quantityAvailable: 0,
			quantityAllocated: 0,
			warehouseId: 'wh_main',
			warehouseName: 'Main Warehouse',
		}),
		stockLevel({
			id: 'sl_receiving',
			skuCode: 'REC-1',
			productName: 'Receiving Item',
			quantityAvailable: 12,
			quantityAllocated: 0,
			warehouseId: 'wh_sub',
			warehouseName: 'Sub Warehouse',
			sourceDeliveryId: 'del_1',
		}),
	]

	it('filters by query and warehouse before applying state', () => {
		expect(
			filterStockLevelsForOperator(items, {
				query: 'rec',
				warehouseId: 'wh_sub',
				state: 'receiving_linked',
			}).map(item => item.id),
		).toEqual(['sl_receiving'])
	})

	it('filters each operator state deterministically', () => {
		expect(
			filterStockLevelsForOperator(items, { state: 'attention' }).map(
				item => item.id,
			),
		).toEqual(['sl_negative'])
		expect(
			filterStockLevelsForOperator(items, { state: 'out_of_stock' }).map(
				item => item.id,
			),
		).toEqual(['sl_stockout'])
		expect(
			filterStockLevelsForOperator(items, { state: 'allocated' }).map(
				item => item.id,
			),
		).toEqual(['sl_negative'])
		expect(
			filterStockLevelsForOperator(items, {
				state: 'low_stock',
				lowStockStockLevelIds: new Set(['sl_receiving']),
			}).map(item => item.id),
		).toEqual(['sl_receiving'])
		expect(
			filterStockLevelsForOperator(items, {
				state: 'reorder_needed',
				lowStockStockLevelIds: new Set(['sl_stockout']),
			}).map(item => item.id),
		).toEqual(['sl_stockout'])
	})
})
