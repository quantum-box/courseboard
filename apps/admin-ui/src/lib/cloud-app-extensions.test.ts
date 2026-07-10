import { describe, expect, it } from 'vitest'
import {
	cloudAppExtensionSurfaceUrl,
	findCloudAppExtension,
	normalizeCloudAppExtensions,
} from './cloud-app-extension-registry'

describe('cloud app extension registry', () => {
	it('normalizes tachyonfield extension urls and filters other targets', () => {
		const extensions = normalizeCloudAppExtensions({
			extensions: [
				{
					appName: 'tachyonfield-golf',
					label: 'ゴルフ料金計算',
					target: 'tachyonfield',
					ui: {
						mode: 'iframe',
						path: '/ui',
						kioskPath: '/dog-run/kiosk',
					},
					apiBaseUrl: 'https://tachyonfield-golf.txcloud.app/',
				},
				{
					appName: 'other',
					label: 'Other',
					target: 'other' as never,
					ui: { mode: 'schema' },
					apiBaseUrl: 'https://other.txcloud.app',
				},
			],
		})

		expect(extensions[0]).toMatchObject({
			appName: 'tachyonfield-golf',
			apiBaseUrl: 'https://tachyonfield-golf.txcloud.app',
			ui: {
				mode: 'iframe',
				path: '/ui',
				url: 'https://tachyonfield-golf.txcloud.app/ui',
				kioskPath: '/dog-run/kiosk',
				kioskUrl: 'https://tachyonfield-golf.txcloud.app/dog-run/kiosk',
			},
		})
		expect(findCloudAppExtension(extensions, 'tachyonfield-golf')).toBeTruthy()
		expect(findCloudAppExtension(extensions, 'other')).toBeUndefined()
	})

	it('adds tenant and proxy context to iframe surface urls', () => {
		const [extension] = normalizeCloudAppExtensions({
			extensions: [
				{
					appName: 'tachyonfield-restaurant',
					label: 'レストラン・ドッグラン受付',
					target: 'tachyonfield',
					ui: { mode: 'iframe', path: '/ui', kioskPath: '/dog-run/kiosk' },
					apiBaseUrl: 'https://tachyonfield-restaurant.txcloud.app/',
				},
			],
		})

		expect(
			cloudAppExtensionSurfaceUrl(
				extension,
				'kiosk',
				'tn_01hjjn348rn3t49zz6hvmfq67p',
			),
		).toBe(
			'https://tachyonfield-restaurant.txcloud.app/dog-run/kiosk?tenant=tn_01hjjn348rn3t49zz6hvmfq67p&extensionAppName=tachyonfield-restaurant&surface=kiosk&proxyBase=%2Fapi%2Fextensions%2Ftachyonfield-restaurant',
		)
	})
})
