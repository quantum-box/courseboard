import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	resolveAuthUrl: vi.fn(),
}))

vi.mock('app/auth', () => ({
	AUTH_SESSION_COOKIE_NAMES: [
		'authjs.session-token',
		'__Secure-authjs.session-token',
	],
	AUTH_SIGN_IN_PATH: '/courseboard-ui/index.html',
	resolveAuthUrl: mocks.resolveAuthUrl,
}))

import { GET } from './route'

describe('courseboard sign_out route', () => {
	beforeEach(() => {
		mocks.resolveAuthUrl.mockReset()
		mocks.resolveAuthUrl.mockImplementation((request?: Request) => {
			if (!request) return 'https://courseboard.txcloud.app'
			const forwardedHost = request.headers.get('x-forwarded-host')
			if (forwardedHost?.endsWith('.txcloud.app')) {
				return `https://${forwardedHost}`
			}
			const url = new URL(request.url)
			if (url.hostname.endsWith('.workers.dev')) {
				return 'https://courseboard.txcloud.app'
			}
			return url.origin
		})
	})

	it('routes workers.dev logout through the canonical origin before sign-in', () => {
		const response = GET(
			new Request('https://courseboard.quantum-box.workers.dev/auth/sign_out', {
				headers: { host: 'courseboard.quantum-box.workers.dev' },
			}),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://courseboard.txcloud.app/auth/sign_out',
		)
		expect(response.headers.get('set-cookie')).toContain(
			'authjs.session-token=',
		)
		expect(mocks.resolveAuthUrl).toHaveBeenCalledOnce()
	})

	it('preserves the expired reason across canonical logout routing', () => {
		const response = GET(
			new Request(
				'https://courseboard.quantum-box.workers.dev/auth/sign_out?error=expired',
				{ headers: { host: 'courseboard.quantum-box.workers.dev' } },
			),
		)

		expect(response.headers.get('location')).toBe(
			'https://courseboard.txcloud.app/auth/sign_out?error=expired',
		)
	})

	it('canonicalizes workers.dev even when the resolved auth URL is polluted', () => {
		mocks.resolveAuthUrl.mockReturnValue(
			'https://courseboard.quantum-box.workers.dev',
		)

		const response = GET(
			new Request('https://courseboard.txcloud.app/auth/sign_out', {
				headers: { host: 'courseboard.txcloud.app' },
			}),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://courseboard.txcloud.app/courseboard-ui/index.html',
		)
	})

	it('keeps txcloud preview logout requests on the preview origin', () => {
		const response = GET(
			new Request(
				'https://courseboard.quantum-box.workers.dev/auth/sign_out?error=expired',
				{
					headers: {
						host: 'courseboard.quantum-box.workers.dev',
						'x-forwarded-host': 'pr357--courseboard.txcloud.app',
						'x-forwarded-proto': 'https',
					},
				},
			),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://pr357--courseboard.txcloud.app/courseboard-ui/index.html?error=expired',
		)
	})

	it('keeps canonical txcloud logout requests on the canonical origin', () => {
		const response = GET(
			new Request('https://courseboard.txcloud.app/auth/sign_out', {
				headers: { host: 'courseboard.txcloud.app' },
			}),
		)

		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toBe(
			'https://courseboard.txcloud.app/courseboard-ui/index.html',
		)
	})

	it('falls back to the request protocol for local forwarded hosts', () => {
		mocks.resolveAuthUrl.mockReturnValue('http://127.0.0.1:3001')

		const response = GET(
			new Request('http://127.0.0.1:3001/auth/sign_out', {
				headers: {
					host: '127.0.0.1:3001',
					'x-forwarded-host': '127.0.0.1:3001',
				},
			}),
		)

		expect(response.headers.get('location')).toBe(
			'http://127.0.0.1:3001/courseboard-ui/index.html',
		)
	})
})
