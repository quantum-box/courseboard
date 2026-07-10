import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

vi.mock('lib/runtime-env', () => ({
	getRuntimeEnv: (name: string) => process.env[name],
}))

describe('photon deployment config', () => {
	beforeEach(() => {
		vi.resetModules()
		vi.unstubAllEnvs()
		process.env = { ...originalEnv }
		clearPhotonEnv()
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		process.env = { ...originalEnv }
	})

	it('uses local defaults without requiring cloud credentials', async () => {
		vi.stubEnv('VITE_PHOTON_DEPLOYMENT_MODE', 'local')
		vi.stubEnv('NEXT_PUBLIC_BACKEND_API_URL', 'http://localhost:50056')

		const { resolvePhotonDeploymentConfig } = await import(
			'./deployment-config'
		)
		const config = resolvePhotonDeploymentConfig({ tenantId: 'op_1' })

		expect(config.deploymentMode).toBe('local')
		expect(config.syncBackend).toBe('rust-server')
		expect(config.endpoints.graphqlUrl).toBe('http://localhost:50056/v1/graphql')
		expect(config.warnings).toEqual([])
	})

	it('resolves preview and cloud to Durable Object Live sync', async () => {
		vi.stubEnv('VITE_PHOTON_DEPLOYMENT_MODE', 'preview')
		vi.stubEnv('VITE_PHOTON_API_BASE_URL', 'https://preview.example.test')
		vi.stubEnv('VITE_PHOTON_SYNC_WS_URL', 'wss://preview.example.test/ws')

		const { resolvePhotonDeploymentConfig } = await import(
			'./deployment-config'
		)
		const config = resolvePhotonDeploymentConfig({ tenantId: 'op_1' })

		expect(config.deploymentMode).toBe('preview')
		expect(config.syncBackend).toBe('cloudflare-durable-object')
		expect(config.endpoints.enginePushUrl).toBe(
			'https://preview.example.test/api/engine/push',
		)
		expect(config.endpoints.liveWebSocketUrl).toBe(
			'wss://preview.example.test/ws',
		)
	})

	it('warns instead of throwing when cloud live websocket is missing', async () => {
		vi.stubEnv('VITE_PHOTON_DEPLOYMENT_MODE', 'cloud')
		vi.stubEnv('VITE_PHOTON_APP_SERVER_BACKEND', 'external-api')
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.txcloud.app')

		const { resolvePhotonDeploymentConfig } = await import(
			'./deployment-config'
		)
		const config = resolvePhotonDeploymentConfig({ tenantId: 'op_1' })

		expect(config.deploymentMode).toBe('cloud')
		expect(config.enabled).toBe(true)
		expect(config.warnings).toContain(
			'VITE_PHOTON_SYNC_WS_URL is missing; Photon Live will stay local-only',
		)
	})

	it('uses the manifest-provided field API URL for cloud defaults', async () => {
		vi.stubEnv('VITE_PHOTON_DEPLOYMENT_MODE', 'cloud')
		vi.stubEnv('VITE_PHOTON_APP_SERVER_BACKEND', 'external-api')
		vi.stubEnv('TACHYON_FIELD_API_URL', 'https://tachyon-field-api.txcloud.app')
		vi.stubEnv('VITE_PHOTON_SYNC_WS_URL', 'wss://field-client.n1.tachy.one/ws')

		const { resolvePhotonDeploymentConfig } = await import(
			'./deployment-config'
		)
		const config = resolvePhotonDeploymentConfig({ tenantId: 'op_1' })

		expect(config.endpoints.apiBaseUrl).toBe(
			'https://tachyon-field-api.txcloud.app',
		)
		expect(config.endpoints.restBaseUrl).toBe(
			'https://tachyon-field-api.txcloud.app/v1',
		)
	})

	it('keeps custom Engine paths on the ERP API base URL', async () => {
		vi.stubEnv('VITE_PHOTON_API_BASE_URL', 'https://erp.example.test')
		vi.stubEnv('VITE_PHOTON_ENGINE_PUSH_PATH', '/v1/erp/photon/engine/push')
		vi.stubEnv('VITE_PHOTON_ENGINE_PULL_PATH', '/v1/erp/photon/engine/pull')

		const { resolvePhotonDeploymentConfig } = await import(
			'./deployment-config'
		)
		const config = resolvePhotonDeploymentConfig({ tenantId: 'op_1' })

		expect(config.endpoints.enginePushUrl).toBe(
			'https://erp.example.test/v1/erp/photon/engine/push',
		)
		expect(config.endpoints.enginePullUrl).toBe(
			'https://erp.example.test/v1/erp/photon/engine/pull',
		)
	})
})

function clearPhotonEnv() {
	for (const key of Object.keys(process.env)) {
		if (
			key.startsWith('VITE_PHOTON_') ||
			key === 'TACHYON_FIELD_API_URL' ||
			key === 'NEXT_PUBLIC_BACKEND_API_URL'
		) {
			delete process.env[key]
		}
	}
}
