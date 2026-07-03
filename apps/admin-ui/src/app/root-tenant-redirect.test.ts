import { describe, expect, it } from 'vitest'
import { OPERATOR_IDS } from 'lib/mode'
import { getRootTenantOptions, getTenantHomePath } from './root-tenant-redirect'

describe('getTenantHomePath', () => {
	it('builds production and sandbox home paths', () => {
		expect(
			getTenantHomePath({
				id: OPERATOR_IDS.production,
				mode: 'production',
			}),
		).toBe(`/${OPERATOR_IDS.production}/home`)
		expect(
			getTenantHomePath({
				id: OPERATOR_IDS.sandbox,
				mode: 'sandbox',
			}),
		).toBe(`/sandbox/${OPERATOR_IDS.sandbox}/home`)
	})
})

describe('getRootTenantOptions', () => {
	it('keeps an empty tenant listing empty', () => {
		expect(getRootTenantOptions([])).toEqual([])
	})

	it('keeps fetched tenants when available', () => {
		const tenants = [
			{
				id: OPERATOR_IDS.production,
				mode: 'production' as const,
				name: 'Production',
			},
		]

		expect(getRootTenantOptions(tenants)).toBe(tenants)
	})

	it('keeps a single fetched tenant on the tenant picker', () => {
		const tenants = [
			{
				id: OPERATOR_IDS.sandbox,
				mode: 'sandbox' as const,
				name: 'Sandbox',
			},
		]

		expect(getRootTenantOptions(tenants)).toBe(tenants)
	})
})
