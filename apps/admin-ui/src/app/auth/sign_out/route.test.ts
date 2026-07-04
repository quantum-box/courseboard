import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	resolveAuthUrl: vi.fn(),
}))

vi.mock('app/auth', () => ({
	AUTH_SESSION_COOKIE_NAMES: [
		'authjs.session-token',
		'__Secure-authjs.session-token',
	],
	resolveAuthUrl: mocks.resolveAuthUrl,
}))

import { GET } from './route'

describe('fieldadmin sign_out route', () => {
	beforeEach(() => {
		mocks.resolveAuthUrl.mockReset()
		mocks.resolveAuthUrl.mockImplementation((request?: Request) => {
			if (!request) return 'https://golfadmin.txcloud.app'
			const forwardedHost = request.headers.get('x-forwarded-host')
			if (forwardedHost?.endsWith('.txcloud.app')) {
				return `https://${forwardedHost}`
			}
			const url = new URL(request.url)
			if (url.hostname.endsWith('.workers.dev')) {
				return 'https://golfadmin.txcloud.app'
			}
			return url.origin
		})
	})

	it('redirects workers.dev logout requests to the canonical txcloud sign-in URL', () => {
		const response = GET(
			new Request('https://golfadmin.quantum-box.workers.dev/auth/sign_out', {
				headers: { host: 'golfadmin.quantum-box.workers.dev' },
			}),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://golfadmin.txcloud.app/auth/sign_in',
		)
		expect(mocks.resolveAuthUrl).toHaveBeenCalledOnce()
	})

	it('canonicalizes workers.dev even when the resolved auth URL is polluted', () => {
		mocks.resolveAuthUrl.mockReturnValue(
			'https://golfadmin.quantum-box.workers.dev',
		)

		const response = GET(
			new Request('https://golfadmin.txcloud.app/auth/sign_out', {
				headers: { host: 'golfadmin.txcloud.app' },
			}),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://golfadmin.txcloud.app/auth/sign_in',
		)
	})

	it('keeps txcloud preview logout requests on the preview origin', () => {
		const response = GET(
			new Request(
				'https://golfadmin.quantum-box.workers.dev/auth/sign_out?error=expired',
				{
					headers: {
						host: 'golfadmin.quantum-box.workers.dev',
						'x-forwarded-host': 'pr357--golfadmin.txcloud.app',
						'x-forwarded-proto': 'https',
					},
				},
			),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://pr357--golfadmin.txcloud.app/auth/sign_in?error=expired',
		)
	})

	it('keeps canonical txcloud logout requests on the canonical origin', () => {
		const response = GET(
			new Request('https://golfadmin.txcloud.app/auth/sign_out', {
				headers: { host: 'golfadmin.txcloud.app' },
			}),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://golfadmin.txcloud.app/auth/sign_in',
		)
	})
})
