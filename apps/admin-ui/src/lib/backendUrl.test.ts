import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBackendBaseUrl, getTachyonFieldAdminBaseUrl } from './backendUrl'

describe('admin backend URL resolution', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
	})

	it('uses the manifest-provided field API URL on the server', () => {
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.txcloud.app')
		vi.stubEnv('BACKEND_API_URL', 'https://server.example.test')

		expect(getBackendBaseUrl()).toBe('https://tachyon-field-api.txcloud.app')
	})

	it('uses the same field API URL for admin extension backend helpers', () => {
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.txcloud.app')
		vi.stubEnv('FIELD_ADMIN_API_URL', 'https://legacy.example.test')

		expect(getTachyonFieldAdminBaseUrl()).toBe(
			'https://tachyon-field-api.txcloud.app',
		)
	})

	it('uses only the public backend URL in the browser', () => {
		vi.stubGlobal('window', { location: { hostname: 'localhost' } })
		vi.stubEnv('TACHYON_FIELD_API_URL', 'http://tachyon-field-api:50056')
		vi.stubEnv('BACKEND_API_URL', 'http://tachyon-field-api:50056')
		vi.stubEnv('NEXT_PUBLIC_BACKEND_API_URL', 'http://localhost:50056')

		expect(getBackendBaseUrl()).toBe('http://localhost:50056')
	})

	it('normalizes Docker service hostnames for local browser runtime', () => {
		vi.stubGlobal('window', { location: { hostname: 'localhost' } })
		vi.stubEnv('NEXT_PUBLIC_BACKEND_API_URL', 'http://tachyon-field-api:50056')

		expect(getBackendBaseUrl()).toBe('http://localhost:50056')
	})

	it('falls back to localhost in local browser runtime', () => {
		vi.stubGlobal('window', { location: { hostname: 'localhost' } })
		vi.stubEnv('TACHYON_FIELD_API_URL', 'http://tachyon-field-api:50056')
		vi.stubEnv('BACKEND_API_URL', 'http://tachyon-field-api:50056')
		vi.stubEnv('NEXT_PUBLIC_BACKEND_API_URL', '')

		expect(getBackendBaseUrl()).toBe('http://localhost:50056')
	})

	it('fails closed in Cloudflare Pages runtime when no manifest URL is set', () => {
		vi.stubEnv('CF_PAGES', '1')
		vi.stubEnv('TACHYON_FIELD_API_URL', '')
		vi.stubEnv('BACKEND_API_URL', '')
		vi.stubEnv('NEXT_PUBLIC_BACKEND_API_URL', '')
		vi.stubEnv('NEXT_PHASE', '')

		expect(() => getBackendBaseUrl()).toThrow(
			'TACHYON Field server backend URL is not configured in runtime env',
		)
	})

	it('fails closed in Cloudflare Workers runtime when no manifest URL is set', () => {
		vi.stubEnv('TACHYON_DEPLOYMENT_TARGET', 'cloudflare_workers')
		vi.stubEnv('TACHYON_FIELD_API_URL', '')
		vi.stubEnv('BACKEND_API_URL', '')
		vi.stubEnv('NEXT_PUBLIC_BACKEND_API_URL', '')
		vi.stubEnv('NEXT_PHASE', '')

		expect(() => getBackendBaseUrl()).toThrow(
			'TACHYON Field server backend URL is not configured in runtime env',
		)
	})

	it('allows Next production build before runtime bindings are attached', () => {
		vi.stubEnv('CF_PAGES', '1')
		vi.stubEnv('TACHYON_FIELD_API_URL', '')
		vi.stubEnv('BACKEND_API_URL', '')
		vi.stubEnv('NEXT_PUBLIC_BACKEND_API_URL', '')
		vi.stubEnv('NEXT_PHASE', 'phase-production-build')

		expect(getBackendBaseUrl()).toBe('http://0.0.0.0:50056')
	})
})
