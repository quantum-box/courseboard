'use server'

import { getServerModePrefix } from 'lib/mode'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
	commitDeliveryReceiving,
	resolveReceivingDiscrepancy,
	type ReceivingDiscrepancyAction,
	uploadDelivery,
} from '../_lib/erp-api'

export async function uploadDeliveryAction(
	tenant: string,
	formData: FormData,
): Promise<void> {
	const document = formData.get('document')
	if (!(document instanceof File) || document.size === 0) {
		throw new Error('納品書ファイルを選択してください')
	}

	const supplierName = (formData.get('supplierName') as string | null) ?? ''
	const warehouseName = (formData.get('warehouseName') as string | null) ?? ''
	const note = (formData.get('note') as string | null) ?? ''

	const { id } = await uploadDelivery(tenant, {
		document,
		supplierName,
		warehouseName,
		note,
	})

	const prefix = getServerModePrefix(tenant)
	revalidatePath(`${prefix}/${tenant}/procurement/deliveries`)

	redirect(`${prefix}/${tenant}/procurement/deliveries/${id}?flash=uploaded`)
}

export async function commitDeliveryReceivingAction(
	tenant: string,
	id: string,
	lines: Array<{
		sku: string
		quantity: number
		lotNo?: string | null
		receivedAt?: string | null
		expiresAt?: string | null
	}>,
): Promise<void> {
	await commitDeliveryReceiving(tenant, id, lines)
	const prefix = getServerModePrefix(tenant)

	revalidatePath(`${prefix}/${tenant}/procurement/deliveries`)
	revalidatePath(`${prefix}/${tenant}/procurement/deliveries/${id}`)
	revalidatePath(`${prefix}/${tenant}/inventory`)

	redirect(`${prefix}/${tenant}/procurement/deliveries/${id}?flash=received`)
}

export async function resolveReceivingDiscrepancyAction(
	tenant: string,
	deliveryId: string,
	discrepancyId: string,
	formData: FormData,
): Promise<void> {
	const action =
		(formData.get('action') as ReceivingDiscrepancyAction | null) ??
		'record_adjustment'
	const note = (formData.get('note') as string | null) ?? ''
	await resolveReceivingDiscrepancy(tenant, discrepancyId, {
		action,
		note,
	})
	const prefix = getServerModePrefix(tenant)

	revalidatePath(`${prefix}/${tenant}/procurement/deliveries`)
	revalidatePath(`${prefix}/${tenant}/procurement/deliveries/${deliveryId}`)

	redirect(
		`${prefix}/${tenant}/procurement/deliveries/${deliveryId}?flash=resolved`,
	)
}

export async function commitDeliveryReceivingManualAction(
	tenant: string,
	id: string,
	formData: FormData,
): Promise<void> {
	const skus = formData.getAll('sku')
	const quantities = formData.getAll('quantity')
	const lines = skus
		.map((sku, index) => {
			const skuText = typeof sku === 'string' ? sku.trim() : ''
			const quantityValue = quantities[index]
			const quantity =
				typeof quantityValue === 'string' ? Number(quantityValue) : Number.NaN

			if (
				!skuText ||
				!Number.isFinite(quantity) ||
				!Number.isInteger(quantity) ||
				quantity <= 0
			) {
				return null
			}

			return { sku: skuText, quantity }
		})
		.filter((line): line is { sku: string; quantity: number } => line !== null)

	if (lines.length === 0) {
		throw new Error('検収確定するSKUと数量を入力してください')
	}

	await commitDeliveryReceivingAction(tenant, id, lines)
}
