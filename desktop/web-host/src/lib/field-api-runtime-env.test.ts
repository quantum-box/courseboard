import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIELD_API_URL = 'https://tachyon-field-api.txcloud.app'
const LEGACY_FIELD_API_URL = 'https://field.api.n1.tachy.one'
const FIELD_CANONICAL_TENANT_ID = 'tn_01ks18jhh1xvggktfzjx5jqsen'
const LEGACY_HOSTING_TENANT_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

const files = {
	root: fileURLToPath(new URL('../../../../tachyon.yaml', import.meta.url)),
	oauth: fileURLToPath(
		new URL(
			'../../../../.tachyon/manifests/courseboard-web-oauth-client.yaml',
			import.meta.url,
		),
	),
}

describe('Course Board production API runtime env', () => {
	it('keeps the root Cloud Apps manifest on the field API endpoint', () => {
		const manifest = readFileSync(files.root, 'utf8')

		expect(manifest).not.toContain(LEGACY_FIELD_API_URL)
		expect(manifest).toContain(`value: ${FIELD_API_URL}`)
	})

	it('keeps browser and server env on the production Field API', () => {
		const manifest = readFileSync(files.root, 'utf8')
		const appManifest = readAppManifest(manifest, 'courseboard')
		expect(appManifest, 'courseboard app manifest present').not.toBe('')

		for (const name of [
			'NEXT_PUBLIC_BACKEND_API_URL',
			'BACKEND_API_URL',
			'TACHYON_FIELD_API_URL',
		]) {
			expect(readEnvValue(appManifest, name), name).toBe(FIELD_API_URL)
		}
	})

	it('targets the Field canonical tenant for the canary transfer', () => {
		const manifest = readFileSync(files.root, 'utf8')
		const oauthManifest = readFileSync(files.oauth, 'utf8')

		expect(readMetadataTenantId(manifest, 'CloudApps')).toBe(
			FIELD_CANONICAL_TENANT_ID,
		)
		expect(readMetadataTenantId(oauthManifest, 'OAuth2Client')).toBe(
			FIELD_CANONICAL_TENANT_ID,
		)
		expect(readEnvValue(readAppManifest(manifest, 'courseboard'), 'NEXT_PUBLIC_PLATFORM_ID')).toBe(
			FIELD_CANONICAL_TENANT_ID,
		)
		expect(manifest).not.toContain(`tenantId: ${LEGACY_HOSTING_TENANT_ID}`)
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

function readMetadataTenantId(manifest: string, kind: string) {
	const escapedKind = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = manifest.match(
		new RegExp(
			`kind: ${escapedKind}\\nmetadata:\\n\\s+name: .+\\n\\s+tenantId: (.+)`,
		),
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
