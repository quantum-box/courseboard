import { describe, expect, it } from 'vitest'
import {
	createAuthActionRequest,
	createCanonicalAuthRequest,
	getSigninProviderId,
	normalizeAuthCallbackUrl,
	resolveSigninProviderActionOptions,
} from './auth-route-core'

describe('fieldadmin Auth.js route adapter', () => {
	it('detects provider sign-in requests without rewriting the action path', () => {
		expect(getSigninProviderId('/api/auth/signin/cognito')).toBe('cognito')
		expect(getSigninProviderId('/api/auth/signin')).toBeUndefined()
		expect(getSigninProviderId('/api/auth/callback/cognito')).toBeUndefined()
	})

	it('does not accept workers.dev callback URLs for auth redirects', () => {
		expect(
			normalizeAuthCallbackUrl(
				'https://fieldadmin.quantum-box.workers.dev/dashboard?from=auth',
			),
		).toBe('/')
		expect(
			normalizeAuthCallbackUrl(
				'https://pr357--fieldadmin.txcloud.app/dashboard?from=auth',
			),
		).toBe('/dashboard?from=auth')
		expect(normalizeAuthCallbackUrl('/dashboard?from=auth')).toBe(
			'/dashboard?from=auth',
		)
	})

	it('normalizes GET provider sign-in to the txcloud preview Auth.js POST action request', async () => {
		const request = new Request(
			'https://fieldadmin.quantum-box.workers.dev/api/auth/signin/cognito?identity_provider=Google',
			{
				headers: {
					accept: 'text/html',
					'x-forwarded-host': 'pr357--fieldadmin.txcloud.app',
					'x-forwarded-proto': 'https',
				},
				method: 'GET',
			},
		)

		const authRequest = createAuthActionRequest(request, {
			authUrl: 'https://pr357--fieldadmin.txcloud.app',
			callbackUrl: '/',
			searchParams: new URLSearchParams({ identity_provider: 'Google' }),
		})

		expect(authRequest.method).toBe('POST')
		expect(new URL(authRequest.url).toString()).toBe(
			'https://pr357--fieldadmin.txcloud.app/api/auth/signin/cognito?identity_provider=Google',
		)
		expect(authRequest.headers.get('host')).toBe(
			'pr357--fieldadmin.txcloud.app',
		)
		expect(authRequest.headers.get('x-forwarded-host')).toBe(
			'pr357--fieldadmin.txcloud.app',
		)
		expect(authRequest.headers.get('x-forwarded-proto')).toBe('https')
		expect(await authRequest.text()).toBe(
			'callbackUrl=%2F&identity_provider=Google',
		)
	})

	it('normalizes POST provider sign-in before Auth.js sees the action', async () => {
		const request = new Request(
			'https://fieldadmin.quantum-box.workers.dev/api/auth/signin/cognito',
			{
				body: new URLSearchParams({
					callbackUrl: 'https://fieldadmin.quantum-box.workers.dev/dashboard',
					csrfToken: 'csrf-token',
					identity_provider: 'Google',
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
				},
				method: 'POST',
			},
		)

		const options = await resolveSigninProviderActionOptions(request)
		expect(options?.callbackUrl).toBe('/')
		expect(options?.searchParams.toString()).toBe('identity_provider=Google')

		const authRequest = createAuthActionRequest(request, {
			authUrl: 'https://fieldadmin.txcloud.app',
			callbackUrl: options?.callbackUrl,
			searchParams: options?.searchParams,
		})

		expect(authRequest.method).toBe('POST')
		expect(new URL(authRequest.url).toString()).toBe(
			'https://fieldadmin.txcloud.app/api/auth/signin/cognito',
		)
		expect(await authRequest.text()).toBe(
			'callbackUrl=%2F&identity_provider=Google',
		)
	})

	it('normalizes standard auth requests to the resolved auth host', () => {
		const request = new Request(
			'https://fieldadmin.quantum-box.workers.dev/api/auth/signin',
			{
				headers: {
					cookie: '__Secure-authjs.callback-url=value-length-only',
					host: 'fieldadmin.quantum-box.workers.dev',
				},
			},
		)

		const authRequest = createCanonicalAuthRequest(request, {
			authUrl: 'https://fieldadmin.txcloud.app',
		})

		expect(authRequest.url).toBe(
			'https://fieldadmin.txcloud.app/api/auth/signin',
		)
		expect(authRequest.headers.get('host')).toBe('fieldadmin.txcloud.app')
		expect(authRequest.headers.get('x-forwarded-host')).toBe(
			'fieldadmin.txcloud.app',
		)
		expect(authRequest.headers.get('x-forwarded-proto')).toBe('https')
		expect(authRequest.headers.get('cookie')).toBe(
			'__Secure-authjs.callback-url=value-length-only',
		)
	})
})
