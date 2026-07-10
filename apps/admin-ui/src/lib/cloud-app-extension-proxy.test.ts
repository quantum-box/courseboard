import { describe, expect, it } from 'vitest'
import {
	buildExtensionProxyHeaders,
	buildExtensionProxyFetchInit,
	buildExtensionProxyUrl,
	EXTENSION_PROXY_TIMEOUT_MS,
	filterExtensionProxyResponseHeaders,
	isAllowedExtensionProxyMethod,
	isExtensionProxyRedirectStatus,
} from './cloud-app-extension-proxy'
import type { CloudAppExtension } from './cloud-app-extension-registry'

const extension: CloudAppExtension = {
	appName: 'tachyonfield-golf',
	label: 'ゴルフ料金計算',
	target: 'tachyonfield',
	ui: { mode: 'iframe', path: '/ui' },
	apiBaseUrl: 'https://tachyonfield-golf.txcloud.app/',
}

describe('cloud app extension proxy', () => {
	it('builds target urls under the registered app origin', () => {
		const result = buildExtensionProxyUrl(
			extension,
			['simulate', 'range'],
			'?limit=10&tenant=tn_01',
		)

		expect(result).toMatchObject({ ok: true })
		expect(result.ok ? result.url.toString() : '').toBe(
			'https://tachyonfield-golf.txcloud.app/simulate/range?limit=10&tenant=tn_01',
		)
	})

	it('rejects non-canonical or unsafe registered app origins', () => {
		expect(
			buildExtensionProxyUrl(
				{ ...extension, apiBaseUrl: 'https://user:pass@example.test' },
				['health'],
				'',
			),
		).toEqual({
			ok: false,
			reason: 'extension api base url must be canonical',
		})

		expect(
			buildExtensionProxyUrl(
				{ ...extension, apiBaseUrl: 'http://extension.internal' },
				['health'],
				'',
			),
		).toEqual({
			ok: false,
			reason: 'extension api base url is not allowed',
		})
	})

	it('replaces authorization and strips hop-by-hop request headers', () => {
		const headers = buildExtensionProxyHeaders(
			new Headers({
				Authorization: 'Bearer user-supplied',
				Connection: 'keep-alive, X-Drop-Me',
				'X-Drop-Me': 'connection-nominated',
				'Content-Type': 'application/json',
				'Proxy-Authorization': 'Bearer proxy',
				'Transfer-Encoding': 'chunked',
			}),
			'backend-session-token',
		)

		expect(headers.get('Authorization')).toBe('Bearer backend-session-token')
		expect(headers.get('Connection')).toBeNull()
		expect(headers.get('X-Drop-Me')).toBeNull()
		expect(headers.get('Proxy-Authorization')).toBeNull()
		expect(headers.get('Transfer-Encoding')).toBeNull()
		expect(headers.get('Content-Type')).toBe('application/json')
	})

	it('allows only the extension proxy method set', () => {
		expect(isAllowedExtensionProxyMethod('GET')).toBe(true)
		expect(isAllowedExtensionProxyMethod('post')).toBe(true)
		expect(isAllowedExtensionProxyMethod('OPTIONS')).toBe(false)
		expect(isAllowedExtensionProxyMethod('TRACE')).toBe(false)
	})

	it('builds manual redirect fetch init with timeout', () => {
		const body = JSON.stringify({ ok: true })
		const init = buildExtensionProxyFetchInit({
			method: 'POST',
			requestHeaders: new Headers({ 'Content-Type': 'application/json' }),
			accessToken: 'backend-session-token',
			body,
		})

		expect(init.method).toBe('POST')
		expect(init.body).toBe(body)
		expect(init.redirect).toBe('manual')
		expect(init.signal).toBeInstanceOf(AbortSignal)
		expect(EXTENSION_PROXY_TIMEOUT_MS).toBe(10_000)
	})

	it('drops GET bodies and denies upstream redirects', () => {
		const init = buildExtensionProxyFetchInit({
			method: 'GET',
			requestHeaders: new Headers(),
			accessToken: 'backend-session-token',
			body: 'ignored',
		})

		expect(init.body).toBeUndefined()
		expect(isExtensionProxyRedirectStatus(301)).toBe(true)
		expect(isExtensionProxyRedirectStatus(308)).toBe(true)
		expect(isExtensionProxyRedirectStatus(200)).toBe(false)
	})

	it('strips unsafe response headers', () => {
		const headers = filterExtensionProxyResponseHeaders(
			new Headers({
				'Content-Encoding': 'br',
				'Content-Type': 'application/json',
				'Set-Cookie': 'extension=session',
				Upgrade: 'websocket',
			}),
		)

		expect(headers.get('Content-Type')).toBe('application/json')
		expect(headers.get('Content-Encoding')).toBeNull()
		expect(headers.get('Set-Cookie')).toBeNull()
		expect(headers.get('Upgrade')).toBeNull()
	})
})
