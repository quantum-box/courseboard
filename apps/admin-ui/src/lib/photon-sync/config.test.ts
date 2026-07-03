import { describe, expect, it } from 'vitest'
import {
	buildPhotonSyncNamespace,
	createPhotonSyncRuntimeConfig,
} from './config'

const scope = {
	platformId: 'tn_platform',
	tenantId: 'op_tenant',
	actorUserId: 'us_actor',
}

describe('photon sync config', () => {
	it('defaults to disabled when the runtime switch is off', () => {
		const result = createPhotonSyncRuntimeConfig(scope)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.reason).toBe('disabled')
			expect(result.namespace).toContain('op_tenant')
		}
	})

	it('builds a tenant and actor scoped namespace', () => {
		const namespace = buildPhotonSyncNamespace({
			...scope,
			schemaVersion: 2,
		})

		expect(namespace).toBe(
			'tachyon-field-admin-ui:photon:v2:tn_platform:op_tenant:us_actor',
		)
	})

	it('rejects missing scope before enabling local sync', () => {
		const result = createPhotonSyncRuntimeConfig({
			...scope,
			tenantId: '',
			enabled: true,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.reason).toBe('invalid_config')
			expect(result.errorSummary).toContain('tenantId')
		}
	})

	it('enables only known domains', () => {
		const result = createPhotonSyncRuntimeConfig({
			...scope,
			enabled: 'true',
			enabledDomains: ['erp.vendors'],
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.config.mode).toBe('read_projection')
			expect(result.config.enabledDomains).toEqual(['erp.vendors'])
		}
	})
})
