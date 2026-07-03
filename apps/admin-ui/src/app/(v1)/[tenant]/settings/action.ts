'use server'

import { auth, authWithCheck } from 'app/auth'
import { getSdkWithAuth } from 'lib/graphqlClientWithAuth'
import {
	type FetchFailure,
	ReliableFetchError,
	fetchJsonWithRetry,
} from 'lib/reliable-fetch'

const DEFAULT_INTEGRATION_API_URL = 'https://integration.api.n1.tachy.one'

type ActionResult<T = undefined> = {
	success: boolean
	message?: string
	data?: T
	error?: FetchFailure
}

export type SquareSyncResult = {
	syncedProducts: number
	syncedVariants: number
	skipped: number
	errors: { objectId: string; kind: string; message?: string }[]
}

export type ProviderStatus = {
	name: string
	providerType: string
	definedAt: string | null
	hasSecrets: boolean
}

export type ExternalServiceStatus = {
	providers: ProviderStatus[]
	connectedOAuthProviders: string[]
}

export async function fetchExternalServiceStatusAction(
	tenantId: string,
): Promise<ActionResult<ExternalServiceStatus>> {
	await authWithCheck()

	try {
		const sdk = await getSdkWithAuth(tenantId)
		const result = await sdk.GetProviderConfigForSettings({
			operatorId: tenantId,
		})

		const providers: ProviderStatus[] =
			result.providerConfigHierarchy.providers.map(p => ({
				name: p.name,
				providerType: p.providerType,
				definedAt: p.definedAt ?? null,
				hasSecrets: p.hasSecrets,
			}))

		return {
			success: true,
			data: {
				providers,
				connectedOAuthProviders: result.connectedOauthProviders,
			},
		}
	} catch (err: unknown) {
		const failure = err instanceof ReliableFetchError ? err.failure : undefined
		const message =
			failure?.message ??
			(err instanceof Error ? err.message : 'Failed to fetch service status')
		console.error('Failed to fetch external service status:', message)
		return {
			success: false,
			message:
				failure?.message ??
				'連携設定と外部サービスの状態取得に失敗しました。再読み込みするか、少し待ってから再試行してください。',
			error: failure,
		}
	}
}

export async function syncProductsAction(
	tenantId: string,
): Promise<ActionResult<SquareSyncResult>> {
	await authWithCheck()

	try {
		const session = await auth()
		if (!session?.accessToken) {
			return {
				success: false,
				message: '認証情報が取得できませんでした',
			}
		}

		const baseUrl =
			process.env.INTEGRATION_API_URL ?? DEFAULT_INTEGRATION_API_URL
		const platformId =
			process.env.NEXT_PUBLIC_PLATFORM_ID ?? 'tn_01hjjn348rn3t49zz6hvmfq67p'

		const result = await fetchJsonWithRetry<{
			synced_products: number
			synced_variants: number
			skipped: number
			errors: {
				object_id: string
				kind: string
				message?: string | null
			}[]
		}>(`${baseUrl.replace(/\/+$/, '')}/integrations/square/catalog/sync`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				Authorization: `Bearer ${session.accessToken}`,
				'x-platform-id': platformId,
				'x-operator-id': tenantId,
			},
			body: JSON.stringify({ full_sync: false }),
		})

		if (!result.ok) {
			return {
				success: false,
				message: `Square 同期に失敗しました。${result.error.message}`,
				error: result.error,
			}
		}

		const json = result.data

		const errors = json.errors.map(e => ({
			objectId: e.object_id,
			kind: e.kind,
			message: e.message ?? undefined,
		}))

		return {
			success: true,
			data: {
				syncedProducts: json.synced_products,
				syncedVariants: json.synced_variants,
				skipped: json.skipped,
				errors,
			},
			message:
				errors.length > 0
					? `${json.synced_products} 商品 / ${json.synced_variants} variant を同期 (${errors.length} 件エラー)`
					: `${json.synced_products} 商品 / ${json.synced_variants} variant を Square から同期しました`,
		}
	} catch (err: unknown) {
		const failure = err instanceof ReliableFetchError ? err.failure : undefined
		const message =
			failure?.message ??
			(err instanceof Error ? err.message : 'Failed to sync Square catalog')
		console.error('Failed to sync Square catalog:', message)
		return {
			success: false,
			message:
				failure?.message ??
				'Square 商品同期に失敗しました。少し待ってから再試行してください。',
			error: failure,
		}
	}
}
