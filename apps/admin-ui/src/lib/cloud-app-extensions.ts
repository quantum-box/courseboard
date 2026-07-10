import { authWithCheck } from 'app/auth'
import { getTachyonApiBaseUrl } from 'lib/backendUrl'
import { fetchJsonWithRetry } from 'lib/reliable-fetch'
import { getRuntimeEnv } from 'lib/runtime-env'
import {
	cloudAppExtensionSurfaceUrl,
	type CloudAppExtension,
	type CloudAppExtensionsResponse,
	findCloudAppExtension,
	normalizeCloudAppExtensions,
} from './cloud-app-extension-registry'

export type { CloudAppExtension, CloudAppExtensionsResponse }
export {
	cloudAppExtensionSurfaceUrl,
	findCloudAppExtension,
	normalizeCloudAppExtensions,
}

export type CloudAppExtensionFetchResult =
	| { ok: true; extensions: CloudAppExtension[]; source: 'registry' | 'stub' }
	| { ok: false; message: string; status?: number }

export async function fetchCloudAppExtensions(
	tenant: string,
): Promise<CloudAppExtensionFetchResult> {
	const stub = getStubExtensions()
	if (stub) {
		return {
			ok: true,
			extensions: normalizeCloudAppExtensions({ extensions: stub }),
			source: 'stub',
		}
	}

	const session = await authWithCheck()
	const baseUrl = getTachyonApiBaseUrl().replace(/\/+$/, '')
	const result = await fetchJsonWithRetry<CloudAppExtensionsResponse>(
		`${baseUrl}/v1/tenants/${encodeURIComponent(
			tenant,
		)}/extensions?target=tachyonfield`,
		{
			headers: {
				Authorization: `Bearer ${session.accessToken}`,
				'Content-Type': 'application/json',
			},
		},
	)

	if (!result.ok) {
		return {
			ok: false,
			message: result.error.message,
			status: result.error.status,
		}
	}

	return {
		ok: true,
		extensions: normalizeCloudAppExtensions(result.data),
		source: 'registry',
	}
}

function getStubExtensions(): CloudAppExtension[] | null {
	if (getRuntimeEnv('TACHYON_FIELD_EXTENSION_REGISTRY_STUB') !== '1') {
		return null
	}

	const rawApps = getRuntimeEnv('TACHYON_FIELD_EXTENSION_REGISTRY_STUB_APPS')
	if (rawApps) {
		try {
			return JSON.parse(rawApps) as CloudAppExtension[]
		} catch {
			return defaultStubExtensions()
		}
	}

	return defaultStubExtensions()
}

function defaultStubExtensions(): CloudAppExtension[] {
	const golfBaseUrl =
		(
			getRuntimeEnv('TACHYON_FIELD_GOLF_EXTENSION_URL') ??
			'https://tachyonfield-golf.txcloud.app'
		).replace(/\/+$/, '')
	const restaurantBaseUrl =
		(
			getRuntimeEnv('TACHYON_FIELD_RESTAURANT_EXTENSION_URL') ??
			'https://tachyonfield-restaurant.txcloud.app'
		).replace(/\/+$/, '')

	return [
		{
			appName: 'tachyonfield-golf',
			label: 'ゴルフ料金計算',
			icon: 'golf',
			navSection: 'tools',
			target: 'tachyonfield',
			ui: {
				mode: 'iframe',
				path: '/ui',
				url: `${golfBaseUrl}/ui`,
			},
			apiBaseUrl: golfBaseUrl,
		},
		{
			appName: 'tachyonfield-restaurant',
			label: 'レストラン・ドッグラン受付',
			icon: 'utensils',
			navSection: 'reservations',
			target: 'tachyonfield',
			ui: {
				mode: 'iframe',
				path: '/ui',
				url: `${restaurantBaseUrl}/ui`,
			},
			apiBaseUrl: restaurantBaseUrl,
		},
	]
}
