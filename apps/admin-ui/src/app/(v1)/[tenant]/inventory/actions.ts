'use server'

import {
	createInventoryStore,
	createStockTransfer,
	updateLowStockDecision,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import { getServerModePrefix } from 'lib/mode'
import { revalidatePath } from 'next/cache'

function getString(formData: FormData, key: string): string {
	const value = formData.get(key)
	return typeof value === 'string' ? value.trim() : ''
}

export async function createStoreAction(tenant: string, formData: FormData) {
	const name = getString(formData, 'name')
	if (!name) {
		throw new Error('店舗名を入力してください')
	}

	await createInventoryStore(tenant, {
		name,
		address: getString(formData, 'address') || undefined,
		businessHours: getString(formData, 'businessHours') || undefined,
		posLocationId: getString(formData, 'posLocationId') || undefined,
	})
	const prefix = getServerModePrefix(tenant)
	revalidatePath(`${prefix}/${tenant}/inventory/stores`)
	revalidatePath(`${prefix}/${tenant}/inventory/locations`)
}

export async function createStockTransferAction(
	tenant: string,
	formData: FormData,
) {
	const sku = getString(formData, 'sku')
	const fromLocationId = getString(formData, 'fromLocationId')
	const toLocationId = getString(formData, 'toLocationId')
	const quantity = Number(getString(formData, 'quantity'))

	if (!sku || !fromLocationId || !toLocationId) {
		throw new Error('SKU と移動元・移動先を入力してください')
	}
	if (!Number.isFinite(quantity) || quantity <= 0) {
		throw new Error('数量は 1 以上で入力してください')
	}

	await createStockTransfer(tenant, {
		sku,
		fromLocationId,
		toLocationId,
		quantity,
		reason: getString(formData, 'reason') || undefined,
		transferredAt: new Date().toISOString(),
	})
	const prefix = getServerModePrefix(tenant)
	revalidatePath(`${prefix}/${tenant}/inventory/transfers`)
}

export async function updateLowStockDecisionAction(
	tenant: string,
	formData: FormData,
) {
	const stockItemId = getString(formData, 'stockItemId')
	const status = getString(formData, 'status')
	const note = getString(formData, 'note')

	if (!stockItemId) {
		throw new Error('Stock item ID is required')
	}
	if (status !== 'on_hold' && status !== 'purchase_candidate') {
		throw new Error('Invalid replenishment decision status')
	}

	await updateLowStockDecision(tenant, stockItemId, {
		status,
		note: note || undefined,
	})
	const prefix = getServerModePrefix(tenant)
	revalidatePath(`${prefix}/${tenant}/inventory/low-stock`)
	revalidatePath(`${prefix}/${tenant}/inventory`)
}
