export type StockLevel = {
	id: string
	stockItemId: string
	skuCode: string
	productName: string
	warehouseId?: string
	warehouseName: string
	quantityOnHand: number
	quantityAvailable: number
	quantityAllocated: number
	lastUpdatedAt: string
	sourceDeliveryId: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}

	if (typeof value === 'string') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}

	return null
}

export function normalizeStockLevel(value: unknown): StockLevel | null {
	const record = asRecord(value)
	if (!record) {
		return null
	}

	const skuCode =
		asString(record.skuCode) ??
		asString(record.sku_code) ??
		asString(record.sku) ??
		asString(record.variantCode) ??
		asString(record.variant_code) ??
		'UNKNOWN-SKU'

	return {
		id:
			asString(record.id) ??
			asString(record.stockLevelId) ??
			asString(record.stock_level_id) ??
			`${skuCode}-${asString(record.warehouseName) ?? asString(record.warehouse_name) ?? 'warehouse'}`,
		stockItemId:
			asString(record.stockItemId) ??
			asString(record.stock_item_id) ??
			asString(record.stockItemID) ??
			asString(record.itemId) ??
			asString(record.item_id) ??
			`sti_${skuCode.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
		skuCode,
		productName:
			asString(record.productName) ??
			asString(record.product_name) ??
			asString(record.itemName) ??
			asString(record.item_name) ??
			asString(record.name) ??
			'未設定',
		warehouseName:
			asString(record.warehouseName) ??
			asString(record.warehouse_name) ??
			asString(record.locationName) ??
			asString(record.location_name) ??
			'未設定',
		warehouseId:
			asString(record.warehouseId) ??
			asString(record.warehouse_id) ??
			asString(record.locationId) ??
			asString(record.location_id) ??
			undefined,
		quantityOnHand:
			asNumber(
				record.quantityOnHand ??
					record.quantity_on_hand ??
					record.qtyOnHand ??
					record.qty_on_hand ??
					record.onHand ??
					record.on_hand,
			) ?? 0,
		quantityAvailable:
			asNumber(
				record.quantityAvailable ??
					record.quantity_available ??
					record.qtyAvailable ??
					record.qty_available ??
					record.available,
			) ?? 0,
		quantityAllocated:
			asNumber(
				record.quantityAllocated ??
					record.quantity_allocated ??
					record.quantityReserved ??
					record.quantity_reserved ??
					record.allocated ??
					record.reserved,
			) ?? 0,
		lastUpdatedAt:
			asString(record.lastUpdatedAt) ??
			asString(record.last_updated_at) ??
			asString(record.updatedAt) ??
			asString(record.updated_at) ??
			asString(record.receivedAt) ??
			asString(record.received_at) ??
			new Date().toISOString(),
		sourceDeliveryId:
			asString(record.sourceDeliveryId) ??
			asString(record.source_delivery_id) ??
			asString(record.deliveryId) ??
			asString(record.delivery_id) ??
			null,
	}
}
