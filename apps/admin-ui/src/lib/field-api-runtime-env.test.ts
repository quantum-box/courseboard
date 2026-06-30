import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'
const LEGACY_FIELD_API_URL = 'https://field.api.n1.tachy.one'

const files = {
	root: fileURLToPath(new URL('../../../../tachyon.yml', import.meta.url)),
}

describe('TACHYON Field production API runtime env', () => {
	it('keeps the root Cloud Apps manifest on the field API endpoint', () => {
		const manifest = readFileSync(files.root, 'utf8')

		expect(manifest).not.toContain(LEGACY_FIELD_API_URL)
		expect(manifest).toContain(`value: ${FIELD_API_URL}`)
	})

	it('sets storefront and admin production backend env to the same endpoint', () => {
		const manifest = readFileSync(files.root, 'utf8')
		const appManifests = {
			admin: readAppManifest(manifest, 'fieldadmin'),
			field: readAppManifest(manifest, 'field'),
			storefront: readAppManifest(manifest, 'tachyonfield'),
		}

		for (const name of [
			'NEXT_PUBLIC_BACKEND_API_URL',
			'BACKEND_API_URL',
			'TACHYON_FIELD_API_URL',
		]) {
			for (const [app, appManifest] of Object.entries(appManifests)) {
				expect(readEnvValue(appManifest, name), `${app} ${name}`).toBe(
					FIELD_API_URL,
				)
			}
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
