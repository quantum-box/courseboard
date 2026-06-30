'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'

type ActionResult<T = undefined> = {
	success: boolean
	message?: string
	data?: T
}

export type ApiKeyData = {
	id: string
	key?: string
	name: string
	key_prefix: string
	use_cases: string[]
	scopes: string[]
	status: 'active' | 'revoked'
	created_at: string
	last_used_at: string | null
	revoked_at: string | null
}

export async function fetchApiKeysAction(
	tenantId: string,
): Promise<ActionResult<ApiKeyData[]>> {
	const session = await authWithCheck()

	try {
		const res = await fetch(joinServerBackendPath('/v1/field/api-keys'), {
			headers: {
				'x-operator-id': tenantId,
				Authorization: `Bearer ${session.accessToken}`,
				'Content-Type': 'application/json',
			},
		})

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to fetch API keys:', text)
			return { success: false, message: 'APIキーの取得に失敗しました' }
		}

		const raw = await res.json()
		const list = (raw.api_keys ?? raw) as Array<{
			id: string
			name: string
			key_prefix: string
			use_cases?: string[]
			scopes: string[]
			created_at: string
			last_used_at: string | null
			revoked_at: string | null
		}>
		const data: ApiKeyData[] = list.map(k => ({
			...k,
			use_cases: k.use_cases ?? k.scopes ?? [],
			scopes: k.scopes ?? k.use_cases ?? [],
			status: k.revoked_at ? ('revoked' as const) : ('active' as const),
		}))
		return { success: true, data }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to fetch API keys'
		console.error('Failed to fetch API keys:', message)
		return { success: false, message }
	}
}

export async function createApiKeyAction(
	tenantId: string,
	name: string,
	useCases: string[],
): Promise<ActionResult<ApiKeyData>> {
	const session = await authWithCheck()

	try {
		const res = await fetch(joinServerBackendPath('/v1/field/api-keys'), {
			method: 'POST',
			headers: {
				'x-operator-id': tenantId,
				Authorization: `Bearer ${session.accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name, useCases }),
		})

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to create API key:', text)
			return { success: false, message: 'APIキーの作成に失敗しました' }
		}

		const data = await res.json()
		return { success: true, data }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to create API key'
		console.error('Failed to create API key:', message)
		return { success: false, message }
	}
}

export async function revokeApiKeyAction(
	tenantId: string,
	keyId: string,
): Promise<ActionResult> {
	const session = await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath(`/v1/field/api-keys/${keyId}/revoke`),
			{
				method: 'POST',
				headers: {
					'x-operator-id': tenantId,
					Authorization: `Bearer ${session.accessToken}`,
					'Content-Type': 'application/json',
				},
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to revoke API key:', text)
			return { success: false, message: 'APIキーの無効化に失敗しました' }
		}

		return { success: true }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to revoke API key'
		console.error('Failed to revoke API key:', message)
		return { success: false, message }
	}
}

export async function deleteApiKeyAction(
	tenantId: string,
	keyId: string,
): Promise<ActionResult> {
	const session = await authWithCheck()

	try {
		const res = await fetch(
			joinServerBackendPath(`/v1/field/api-keys/${keyId}`),
			{
				method: 'DELETE',
				headers: {
					'x-operator-id': tenantId,
					Authorization: `Bearer ${session.accessToken}`,
					'Content-Type': 'application/json',
				},
			},
		)

		if (!res.ok) {
			const text = await res.text()
			console.error('Failed to delete API key:', text)
			return { success: false, message: 'APIキーの削除に失敗しました' }
		}

		return { success: true }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to delete API key'
		console.error('Failed to delete API key:', message)
		return { success: false, message }
	}
}
