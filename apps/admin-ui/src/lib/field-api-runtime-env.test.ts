import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'
const LEGACY_FIELD_API_URL = 'https://field.api.n1.tachy.one'

const files = {
	root: fileURLToPath(new URL('../../../../tachyon.yaml', import.meta.url)),
}

describe('Course Board production API runtime env', () => {
	it('keeps the root Cloud Apps manifest on the field API endpoint', () => {
		const manifest = readFileSync(files.root, 'utf8')

		expect(manifest).not.toContain(LEGACY_FIELD_API_URL)
		expect(manifest).toContain(`value: ${FIELD_API_URL}`)
	})

	it('keeps browser env public and routes server backend through internal service', () => {
		const manifest = readFileSync(files.root, 'utf8')
		const appManifest = readAppManifest(manifest, 'courseboard')
		expect(appManifest, 'courseboard app manifest present').not.toBe('')

		// Browser-exposed env must stay on the public URL; server-side env
		// resolves the internal origin via PLT-2405 internalService (same
		// split as tachyonfield PR #468) to avoid the worker-subrequest 522
		// (PLT-2373). Requires tachyon-field-api registered in the hosting
		// tenant (PLT-2442).
		expect(
			readEnvValue(appManifest, 'NEXT_PUBLIC_BACKEND_API_URL'),
			'NEXT_PUBLIC_BACKEND_API_URL',
		).toBe(FIELD_API_URL)

		for (const name of ['BACKEND_API_URL', 'TACHYON_FIELD_API_URL']) {
			expect(readInternalServiceAppName(appManifest, name), name).toBe(
				'tachyon-field-api',
			)
		}
	})

	it('does not keep legacy field API env fallbacks in runtime source', () => {
		const runtimeSources = readRuntimeSources(
			fileURLToPath(new URL('../', import.meta.url)),
		)

		expect(runtimeSources).not.toMatch(
			/\b(?:process\.env\.|getRuntimeEnv\(['"])FIELD_API_URL\b/,
		)
		expect(runtimeSources).not.toMatch(
			/\b(?:process\.env\.|getRuntimeEnv\(['"])FIELD_ADMIN_API_URL\b/,
		)
		expect(runtimeSources).not.toContain(LEGACY_FIELD_API_URL)
	})
})

function readAppManifest(manifest: string, appName: string) {
	const escapedName = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = manifest.match(
		new RegExp(
			`^    - name: ${escapedName}\\n[\\s\\S]*?(?=^    - name: |^---\\n|(?![\\s\\S]))`,
			'm',
		),
	)

	return match?.[0] ?? ''
}

function readInternalServiceAppName(manifest: string, name: string) {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = manifest.match(
		new RegExp(
			`- name: ${escapedName}\\n\\s+valueFrom:\\n\\s+internalService:\\n\\s+appName: (.+)`,
		),
	)

	return match?.[1]?.trim()
}

function readEnvValue(manifest: string, name: string) {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = manifest.match(
		new RegExp(`- name: ${escapedName}\\n\\s+value: (.+)`),
	)

	return match?.[1]?.trim()
}

function readRuntimeSources(directory: string): string {
	return readdirSync(directory)
		.flatMap(entry => {
			const path = `${directory}/${entry}`
			const stat = statSync(path)
			if (stat.isDirectory()) {
				return readRuntimeSources(path)
			}
			if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) {
				return ''
			}
			return readFileSync(path, 'utf8')
		})
		.join('\n')
}
