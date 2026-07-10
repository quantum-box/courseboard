import { describe, expect, it } from 'vitest'
import {
	decodeTenantNameCacheValue,
	encodeTenantNameCacheValue,
	getSidebarClosedStorageKey,
	getTenantNameStorageKey,
} from './v1-admin-shell'

describe('getSidebarClosedStorageKey', () => {
	it('scopes the pinned sidebar state by tenant and mode', () => {
		expect(
			getSidebarClosedStorageKey('', 'tn_01kshr165k3wwr8xyk0e6vy36c'),
		).toBe(
			'courseboard-admin-sidebar-collapsed:production:tn_01kshr165k3wwr8xyk0e6vy36c',
		)
		expect(
			getSidebarClosedStorageKey('/sandbox', 'tn_01kshr165k3wwr8xyk0e6vy36c'),
		).toBe(
			'courseboard-admin-sidebar-collapsed:sandbox:tn_01kshr165k3wwr8xyk0e6vy36c',
		)
		expect(
			getSidebarClosedStorageKey('', 'tn_01ks18jhh1xvggktfzjx5jqsen'),
		).not.toBe(getSidebarClosedStorageKey('', 'tn_01kshr165k3wwr8xyk0e6vy36c'))
	})
})

describe('tenant name cache helpers', () => {
	it('scopes tenant name cache by tenant', () => {
		expect(getTenantNameStorageKey('tn_operator_1')).toBe(
			'courseboard-admin-tenant-name:tn_operator_1',
		)
		expect(getTenantNameStorageKey('tn_operator_1')).not.toBe(
			getTenantNameStorageKey('tn_operator_2'),
		)
	})

	it('round-trips a resolved tenant name', () => {
		const encoded = encodeTenantNameCacheValue(' Store Admin ')

		expect(decodeTenantNameCacheValue(encoded)).toEqual({
			hit: true,
			tenantName: 'Store Admin',
		})
	})

	it('caches empty tenant name lookups as a hit', () => {
		const encoded = encodeTenantNameCacheValue(null)

		expect(decodeTenantNameCacheValue(encoded)).toEqual({
			hit: true,
			tenantName: null,
		})
		expect(decodeTenantNameCacheValue(null)).toEqual({
			hit: false,
			tenantName: null,
		})
	})
})
