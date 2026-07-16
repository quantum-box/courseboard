import { describe, expect, it } from 'vitest'
import {
	canonicalizeAuthUrl,
	resolveAuthUrlFromEnv,
	resolveAuthUrlFromRequest,
} from './auth-url-core'

describe('canonicalizeAuthUrl', () => {
	it('forces workers.dev URLs to the final txcloud auth origin', () => {
		expect(
			canonicalizeAuthUrl('https://courseboard.quantum-box.workers.dev'),
		).toBe('https://courseboard.txcloud.app')
	})

	it('keeps txcloud preview URLs intact', () => {
		expect(canonicalizeAuthUrl('https://pr357--courseboard.txcloud.app/')).toBe(
			'https://pr357--courseboard.txcloud.app',
		)
	})
})

describe('resolveAuthUrlFromEnv', () => {
	it('prefers txcloud CF_PAGES_URL on preview deployments', () => {
		expect(
			resolveAuthUrlFromEnv({
				cfPagesUrl: 'https://pr357--courseboard.txcloud.app/',
				authUrl: 'https://courseboard.txcloud.app',
				nextAuthUrl: 'https://courseboard.txcloud.app',
			}),
		).toBe('https://pr357--courseboard.txcloud.app')
	})

	it('does not use workers.dev CF_PAGES_URL for auth callbacks', () => {
		expect(
			resolveAuthUrlFromEnv({
				cfPagesUrl: 'https://courseboard.quantum-box.workers.dev',
				authUrl: 'https://courseboard.txcloud.app',
			}),
		).toBe('https://courseboard.txcloud.app')
	})

	it('falls back to the canonical auth URL when only workers.dev is present', () => {
		expect(
			resolveAuthUrlFromEnv({
				cfPagesUrl: 'https://courseboard.quantum-box.workers.dev',
			}),
		).toBe('https://courseboard.txcloud.app')
	})

	it('falls back to AUTH_URL when CF_PAGES_URL is unset', () => {
		expect(
			resolveAuthUrlFromEnv({
				authUrl: 'https://courseboard.txcloud.app',
				nextAuthUrl: 'https://preview.example.com',
			}),
		).toBe('https://courseboard.txcloud.app')
	})

	it('falls back to NEXTAUTH_URL and strips trailing slashes', () => {
		expect(
			resolveAuthUrlFromEnv({
				nextAuthUrl: 'http://localhost:3001/',
			}),
		).toBe('http://localhost:3001')
	})
})

describe('resolveAuthUrlFromRequest', () => {
	it('uses forwarded preview host when CF_PAGES_URL is unset', () => {
		expect(
			resolveAuthUrlFromRequest({
				headers: new Headers({
					host: 'courseboard.quantum-box.workers.dev',
					'x-forwarded-host': 'pr357--courseboard.txcloud.app',
					'x-forwarded-proto': 'https',
				}),
				requestUrl:
					'https://courseboard.quantum-box.workers.dev/api/auth/signin/cognito',
			}),
		).toBe('https://pr357--courseboard.txcloud.app')
	})

	it('uses standard Forwarded txcloud host when present', () => {
		expect(
			resolveAuthUrlFromRequest({
				headers: new Headers({
					forwarded:
						'for=192.0.2.10;proto=https;host=pr357--courseboard.txcloud.app',
					host: 'internal.worker',
				}),
				requestUrl: 'http://internal.worker/api/auth/callback/cognito',
			}),
		).toBe('https://pr357--courseboard.txcloud.app')
	})

	it('does not resolve workers.dev as an auth callback origin', () => {
		expect(
			resolveAuthUrlFromRequest({
				headers: new Headers({
					host: 'courseboard.quantum-box.workers.dev',
				}),
				requestUrl:
					'https://courseboard.quantum-box.workers.dev/api/auth/signin/cognito',
			}),
		).toBeUndefined()
	})

	it('falls back to the request host and protocol', () => {
		expect(
			resolveAuthUrlFromRequest({
				headers: new Headers({ host: 'localhost:3001' }),
				requestUrl: 'http://localhost:3001/api/auth/signin/cognito',
			}),
		).toBe('http://localhost:3001')
	})
})
