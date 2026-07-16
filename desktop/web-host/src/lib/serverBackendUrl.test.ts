import { readdirSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	getServerBackendBaseUrl,
	joinServerBackendPath,
} from './serverBackendUrl'

function collectSourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const path = `${dir}/${entry.name}`
		if (entry.isDirectory()) return collectSourceFiles(path)
		if (
			!/\.(ts|tsx)$/.test(entry.name) ||
			/\.test\.(ts|tsx)$/.test(entry.name)
		) {
			return []
		}
		return [path]
	})
}

describe('getServerBackendBaseUrl', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('removes trailing slashes from the runtime Field API URL', () => {
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://field-api.example.test/')

		expect(getServerBackendBaseUrl()).toBe('https://field-api.example.test')
	})

	it('joins backend paths without creating double slashes', () => {
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://field-api.example.test/')

		expect(joinServerBackendPath('/v1/invoices')).toBe(
			'https://field-api.example.test/v1/invoices',
		)
		expect(joinServerBackendPath('v1/invoices')).toBe(
			'https://field-api.example.test/v1/invoices',
		)
		expect(joinServerBackendPath('//v1/invoices')).toBe(
			'https://field-api.example.test/v1/invoices',
		)
	})

	it('keeps app Field API calls behind the normalized join helper', () => {
		const appDir = fileURLToPath(new URL('../app', import.meta.url))
		const checks: Array<{ pattern: RegExp; message: string }> = [
			{
				pattern: /process\.env\.TACHYON_FIELD_API_URL/,
				message: 'read TACHYON_FIELD_API_URL through serverBackendUrl.ts',
			},
			{
				pattern: /const\s+TACHYON_FIELD_API_URL\s*=/,
				message: 'do not keep per-action Field API base constants',
			},
			{
				pattern: /getServerBackendBaseUrl\(\)/,
				message: 'join app Field API paths with joinServerBackendPath()',
			},
			{
				pattern: /\$\{[^}]*TACHYON_FIELD_API_URL[^}]*\}/,
				message: 'do not interpolate raw Field API base URLs',
			},
			{
				pattern: /\$\{[^}]*ERP_API_BASE_URL[^}]*\}/,
				message:
					'join procurement Field API paths with joinServerBackendPath()',
			},
		]
		const violations = collectSourceFiles(appDir).flatMap(file => {
			const source = readFileSync(file, 'utf8')
			return checks
				.filter(check => check.pattern.test(source))
				.map(check => `${relative(appDir, file)}: ${check.message}`)
		})

		expect(violations).toEqual([])
	})
})
