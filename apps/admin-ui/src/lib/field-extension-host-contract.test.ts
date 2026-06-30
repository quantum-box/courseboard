import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
	FIELD_EXTENSION_HOST_MESSAGE_EVENTS,
	FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
	FIELD_EXTENSION_IFRAME_SANDBOX_POLICY,
	FIELD_EXTENSION_PERMISSION_ACTIONS,
	FIELD_EXTENSION_PERMISSION_CONTEXT,
	FIELD_EXTENSION_REQUIRED_PERMISSIONS,
	appendFieldExtensionHostContext,
	buildFieldExtensionHostContext,
	buildFieldExtensionProxyRequestUrl,
	isFieldExtensionAllowedMessageOrigin,
	parseFieldExtensionHostContext,
	parseFieldExtensionHostMessage,
} from './field-extension-host-contract'

describe('field extension host contract', () => {
	const lifecycleContext = buildFieldExtensionHostContext(
		'tachyonfield-golf',
		'tn_01hjjn348rn3t49zz6hvmfq67p',
		'ui',
	)

	it('builds and parses host context query params', () => {
		const iframeUrl = appendFieldExtensionHostContext(
			'https://tachyonfield-golf.txcloud.app/ui',
			lifecycleContext,
		)

		expect(iframeUrl).toBe(
			'https://tachyonfield-golf.txcloud.app/ui?tenant=tn_01hjjn348rn3t49zz6hvmfq67p&extensionAppName=tachyonfield-golf&surface=ui&proxyBase=%2Fapi%2Fextensions%2Ftachyonfield-golf',
		)

		const parsed = parseFieldExtensionHostContext(
			new URL(iframeUrl).searchParams,
		)
		expect(parsed).toEqual(lifecycleContext)
	})

	it('rejects invalid proxy base paths', () => {
		expect(
			parseFieldExtensionHostContext({
				tenant: 'tn_test',
				extensionAppName: 'tachyonfield-golf',
				surface: 'ui',
				proxyBase: 'https://evil.example/api',
			}),
		).toBeNull()
	})

	it('builds same-origin proxy request urls with tenant scope', () => {
		const context = buildFieldExtensionHostContext(
			'tachyonfield-restaurant',
			'tn_01hjjn348rn3t49zz6hvmfq67p',
			'kiosk',
		)

		expect(
			buildFieldExtensionProxyRequestUrl(context, 'health', '?verbose=1'),
		).toBe(
			'/api/extensions/tachyonfield-restaurant/health?verbose=1&tenant=tn_01hjjn348rn3t49zz6hvmfq67p',
		)
	})

	it('keeps the M1 permission vocabulary tenant-scoped and field-owned', () => {
		expect(FIELD_EXTENSION_PERMISSION_CONTEXT).toBe('field')
		expect(Object.values(FIELD_EXTENSION_PERMISSION_ACTIONS).sort()).toEqual([
			'field:ListExtensions',
			'field:ListReservations',
			'field:ManageExtensions',
			'field:ManageReservations',
		])
	})

	it('maps host, proxy, and lifecycle surfaces to explicit permission sets', () => {
		expect(FIELD_EXTENSION_REQUIRED_PERMISSIONS.hostContextRead).toEqual([
			'field:ListExtensions',
		])
		expect(FIELD_EXTENSION_REQUIRED_PERMISSIONS.proxyRead).toEqual([
			'field:ListExtensions',
			'field:ListReservations',
		])
		expect(FIELD_EXTENSION_REQUIRED_PERMISSIONS.proxyWrite).toEqual([
			'field:ListExtensions',
			'field:ManageReservations',
		])
		expect(FIELD_EXTENSION_REQUIRED_PERMISSIONS.lifecycleManage).toEqual([
			'field:ManageExtensions',
		])
	})

	it('keeps the local auth manifest aligned with the M1 vocabulary', () => {
		const manifest = readFileSync(
			fileURLToPath(
				new URL(
					'../../../../.tachyon/manifests/tachyonfield-auth.yml',
					import.meta.url,
				),
			),
			'utf8',
		)

		for (const action of Object.values(FIELD_EXTENSION_PERMISSION_ACTIONS)) {
			const [, name] = action.split(':')
			expect(manifest).toContain(`- context: field\n  name: ${name}`)
		}
	})

	it('defines the iframe sandbox policy without top navigation privileges', () => {
		expect(FIELD_EXTENSION_IFRAME_SANDBOX_POLICY.split(' ').sort()).toEqual([
			'allow-forms',
			'allow-popups',
			'allow-popups-to-escape-sandbox',
			'allow-same-origin',
			'allow-scripts',
		])
		expect(FIELD_EXTENSION_IFRAME_SANDBOX_POLICY).not.toContain(
			'allow-top-navigation',
		)
	})

	it('allows lifecycle messages only from the resolved iframe origin', () => {
		const iframeUrl =
			'https://tachyonfield-golf.txcloud.app/ui?tenant=tn_test'

		expect(
			isFieldExtensionAllowedMessageOrigin(
				'https://tachyonfield-golf.txcloud.app',
				iframeUrl,
			),
		).toBe(true)
		expect(
			isFieldExtensionAllowedMessageOrigin(
				'https://tachyonfield-restaurant.txcloud.app',
				iframeUrl,
			),
		).toBe(false)
		expect(
			isFieldExtensionAllowedMessageOrigin('not-a-url', iframeUrl),
		).toBe(false)
	})

	it('parses ready, resize, error, and reload lifecycle messages', () => {
		expect(
			parseFieldExtensionHostMessage({
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready,
				tenant: lifecycleContext.tenant,
				extensionAppName: lifecycleContext.extensionAppName,
				surface: lifecycleContext.surface,
			}),
		).toEqual({
			source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
			event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready,
			tenant: lifecycleContext.tenant,
			extensionAppName: lifecycleContext.extensionAppName,
			surface: lifecycleContext.surface,
		})

		expect(
			parseFieldExtensionHostMessage({
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.resize,
				tenant: lifecycleContext.tenant,
				extensionAppName: lifecycleContext.extensionAppName,
				surface: lifecycleContext.surface,
				height: 720,
			}),
		).toEqual({
			source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
			event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.resize,
			tenant: lifecycleContext.tenant,
			extensionAppName: lifecycleContext.extensionAppName,
			surface: lifecycleContext.surface,
			height: 720,
		})

		expect(
			parseFieldExtensionHostMessage({
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.error,
				tenant: lifecycleContext.tenant,
				extensionAppName: lifecycleContext.extensionAppName,
				surface: lifecycleContext.surface,
				code: 'QUOTE_FAILED',
				message: 'Quote failed',
			}),
		).toEqual({
			source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
			event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.error,
			tenant: lifecycleContext.tenant,
			extensionAppName: lifecycleContext.extensionAppName,
			surface: lifecycleContext.surface,
			code: 'QUOTE_FAILED',
			message: 'Quote failed',
		})

		expect(
			parseFieldExtensionHostMessage({
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.reload,
				tenant: lifecycleContext.tenant,
				extensionAppName: lifecycleContext.extensionAppName,
				surface: lifecycleContext.surface,
			}),
		).toEqual({
			source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
			event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.reload,
			tenant: lifecycleContext.tenant,
			extensionAppName: lifecycleContext.extensionAppName,
			surface: lifecycleContext.surface,
		})
	})

	it('rejects malformed lifecycle messages', () => {
		expect(parseFieldExtensionHostMessage('field-extension:ready')).toBeNull()
		expect(
			parseFieldExtensionHostMessage({
				source: 'other',
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready,
			}),
		).toBeNull()
		expect(
			parseFieldExtensionHostMessage({
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.resize,
				tenant: lifecycleContext.tenant,
				extensionAppName: lifecycleContext.extensionAppName,
				surface: lifecycleContext.surface,
				height: 100,
			}),
		).toBeNull()
		expect(
			parseFieldExtensionHostMessage({
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.error,
				tenant: lifecycleContext.tenant,
				extensionAppName: lifecycleContext.extensionAppName,
				surface: lifecycleContext.surface,
				message: '',
			}),
		).toBeNull()
	})

	it('rejects lifecycle messages for a different host context', () => {
		expect(
			parseFieldExtensionHostMessage(
				{
					source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
					event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready,
					tenant: 'tn_other',
					extensionAppName: lifecycleContext.extensionAppName,
					surface: lifecycleContext.surface,
				},
				lifecycleContext,
			),
		).toBeNull()
	})
})
