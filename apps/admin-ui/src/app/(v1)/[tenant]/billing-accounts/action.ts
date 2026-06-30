'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'

type ActionResult<T = undefined> = {
	success: boolean
	message?: string
	data?: T
}

export type BillingAccountData = {
	id: string
	name: string
	created_at: string
	updated_at: string
}

export type OperatorAssociation = {
	operator_id: string
	billing_account_id: string
	created_at: string
}

export async function fetchBillingAccountsAction(): Promise<
	ActionResult<BillingAccountData[]>
> {
	await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath('/v1/field/billing-accounts'),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to fetch billing accounts:', text)
			return {
				success: false,
				message: '請求アカウントの取得に失敗しました',
			}
		}

		const data = await res.json()
		return { success: true, data }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to fetch billing accounts'
		console.error('Failed to fetch billing accounts:', message)
		return { success: false, message }
	}
}

export async function fetchBillingAccountAction(
	id: string,
): Promise<ActionResult<BillingAccountData>> {
	await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath(`/v1/field/billing-accounts/${id}`),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to fetch billing account:', text)
			return {
				success: false,
				message: '請求アカウントの取得に失敗しました',
			}
		}

		const data = await res.json()
		return { success: true, data }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to fetch billing account'
		console.error('Failed to fetch billing account:', message)
		return { success: false, message }
	}
}

export async function createBillingAccountAction(
	name: string,
): Promise<ActionResult<BillingAccountData>> {
	await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath('/v1/field/billing-accounts'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name }),
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to create billing account:', text)
			return {
				success: false,
				message: '請求アカウントの作成に失敗しました',
			}
		}

		const data = await res.json()
		return { success: true, data }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to create billing account'
		console.error('Failed to create billing account:', message)
		return { success: false, message }
	}
}

export async function updateBillingAccountAction(
	id: string,
	name: string,
): Promise<ActionResult<BillingAccountData>> {
	await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath(`/v1/field/billing-accounts/${id}`),
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name }),
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to update billing account:', text)
			return {
				success: false,
				message: '請求アカウントの更新に失敗しました',
			}
		}

		const data = await res.json()
		return { success: true, data }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to update billing account'
		console.error('Failed to update billing account:', message)
		return { success: false, message }
	}
}

export async function fetchOperatorsAction(
	billingAccountId: string,
): Promise<ActionResult<OperatorAssociation[]>> {
	await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath(
				`/v1/field/billing-accounts/${billingAccountId}/operators`,
			),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to fetch operators:', text)
			return {
				success: false,
				message: 'オペレーターの取得に失敗しました',
			}
		}

		const data = await res.json()
		return { success: true, data }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to fetch operators'
		console.error('Failed to fetch operators:', message)
		return { success: false, message }
	}
}

export async function addOperatorAction(
	billingAccountId: string,
	operatorId: string,
): Promise<ActionResult> {
	await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath(
				`/v1/field/billing-accounts/${billingAccountId}/operators`,
			),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ operator_id: operatorId }),
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to add operator:', text)
			return {
				success: false,
				message: 'オペレーターの追加に失敗しました',
			}
		}

		return { success: true }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to add operator'
		console.error('Failed to add operator:', message)
		return { success: false, message }
	}
}

export async function removeOperatorAction(
	billingAccountId: string,
	operatorId: string,
): Promise<ActionResult> {
	await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath(
				`/v1/field/billing-accounts/${billingAccountId}/operators/${operatorId}`,
			),
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to remove operator:', text)
			return {
				success: false,
				message: 'オペレーターの削除に失敗しました',
			}
		}

		return { success: true }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to remove operator'
		console.error('Failed to remove operator:', message)
		return { success: false, message }
	}
}
