import type {
	InventoryLocation,
	LowStockAlert,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import type { StockLevel } from 'app/(v1)/[tenant]/procurement/_lib/stock-level-normalizer'

export type InventoryOperatorSummary = {
	stockLevelCount: number
	warehouseCount: number
	storeCount: number
	totalOnHand: number
	totalAvailable: number
	totalAllocated: number
	outOfStockCount: number
	negativeAvailableCount: number
	lowStockAlertCount: number
	pendingLowStockCount: number
	purchaseCandidateCount: number
	lastUpdatedAt: string | null
}

export type StockLevelFilterState =
	| 'all'
	| 'attention'
	| 'low_stock'
	| 'reorder_needed'
	| 'out_of_stock'
	| 'allocated'
	| 'receiving_linked'

export type StockLevelFilters = {
	query?: string
	warehouseId?: string
	state: StockLevelFilterState
	lowStockStockLevelIds?: ReadonlySet<string>
}

export function summarizeInventoryForOperator(input: {
	stockLevels: StockLevel[]
	lowStockAlerts: LowStockAlert[]
	locations: InventoryLocation[]
}): InventoryOperatorSummary {
	const lastUpdatedAt = input.stockLevels
		.map(item => new Date(item.lastUpdatedAt))
		.filter(date => !Number.isNaN(date.getTime()))
		.sort((a, b) => b.getTime() - a.getTime())[0]

	return {
		stockLevelCount: input.stockLevels.length,
		warehouseCount: input.locations.filter(item => item.kind === 'warehouse')
			.length,
		storeCount: input.locations.filter(item => item.kind === 'store').length,
		totalOnHand: input.stockLevels.reduce(
			(sum, item) => sum + item.quantityOnHand,
			0,
		),
		totalAvailable: input.stockLevels.reduce(
			(sum, item) => sum + item.quantityAvailable,
			0,
		),
		totalAllocated: input.stockLevels.reduce(
			(sum, item) => sum + item.quantityAllocated,
			0,
		),
		outOfStockCount: input.stockLevels.filter(
			item => item.quantityAvailable === 0,
		).length,
		negativeAvailableCount: input.stockLevels.filter(
			item => item.quantityAvailable < 0,
		).length,
		lowStockAlertCount: input.lowStockAlerts.length,
		pendingLowStockCount: input.lowStockAlerts.filter(
			item => item.decisionStatus === 'pending',
		).length,
		purchaseCandidateCount: input.lowStockAlerts.filter(
			item => item.decisionStatus === 'purchase_candidate',
		).length,
		lastUpdatedAt: lastUpdatedAt?.toISOString() ?? null,
	}
}

export function normalizeStockLevelFilterState(
	value: string | string[] | undefined,
): StockLevelFilterState {
	const raw = Array.isArray(value) ? value[0] : value
	switch (raw) {
		case 'attention':
		case 'low_stock':
		case 'reorder_needed':
		case 'out_of_stock':
		case 'allocated':
		case 'receiving_linked':
			return raw
		default:
			return 'all'
	}
}

export function filterStockLevelsForOperator(
	items: StockLevel[],
	filters: StockLevelFilters,
): StockLevel[] {
	const query = filters.query?.trim().toLowerCase()

	return items.filter(item => {
		if (
			query &&
			![item.skuCode, item.productName, item.warehouseName, item.stockItemId]
				.filter(Boolean)
				.some(value => value.toLowerCase().includes(query))
		) {
			return false
		}

		if (filters.warehouseId && item.warehouseId !== filters.warehouseId) {
			return false
		}

		switch (filters.state) {
			case 'attention':
				return item.quantityAvailable < 0
			case 'low_stock':
			case 'reorder_needed':
				return filters.lowStockStockLevelIds?.has(item.id) ?? false
			case 'out_of_stock':
				return item.quantityAvailable === 0
			case 'allocated':
				return item.quantityAllocated > 0
			case 'receiving_linked':
				return Boolean(item.sourceDeliveryId)
			case 'all':
				return true
		}
	})
}

export function getStockLevelOperatorState(
	item: StockLevel,
	isLowStock = false,
): {
	label: string
	variant: 'default' | 'destructive' | 'outline' | 'secondary'
} {
	if (item.quantityAvailable < 0) {
		return { label: '要確認', variant: 'destructive' }
	}
	if (item.quantityAvailable === 0) {
		return { label: '欠品', variant: 'secondary' }
	}
	if (isLowStock) {
		return { label: '低在庫', variant: 'secondary' }
	}
	if (item.quantityAllocated > 0) {
		return { label: '引当あり', variant: 'outline' }
	}
	if (item.sourceDeliveryId) {
		return { label: '入荷反映あり', variant: 'secondary' }
	}
	return { label: '通常', variant: 'default' }
}
