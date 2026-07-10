import { describe, expect, it } from 'vitest'
import {
	getPinnedNavigationStorageKey,
	normalizePinnedNavigationPaths,
	togglePinnedNavigationPath,
} from './pinnedNavigation'

describe('getPinnedNavigationStorageKey', () => {
	it('scopes pinned navigation by tenant and mode', () => {
		expect(getPinnedNavigationStorageKey('', 'tn_prod')).toBe(
			'courseboard-admin-pinned-nav-items:production:tn_prod',
		)
		expect(getPinnedNavigationStorageKey('/sandbox', 'tn_prod')).toBe(
			'courseboard-admin-pinned-nav-items:sandbox:tn_prod',
		)
		expect(getPinnedNavigationStorageKey('', 'tn_other')).not.toBe(
			getPinnedNavigationStorageKey('', 'tn_prod'),
		)
	})
})

describe('normalizePinnedNavigationPaths', () => {
	it('keeps unique menu paths and drops invalid values', () => {
		expect(
			normalizePinnedNavigationPaths([
				'/erp/receipts',
				'/erp/receipts',
				'erp/sales-ledger',
				42,
				'/erp/sales-ledger',
			]),
		).toEqual(['/erp/receipts', '/erp/sales-ledger'])
	})
})

describe('togglePinnedNavigationPath', () => {
	it('appends an unpinned path', () => {
		expect(togglePinnedNavigationPath(['/erp/receipts'], '/reports')).toEqual([
			'/erp/receipts',
			'/reports',
		])
	})

	it('removes a pinned path', () => {
		expect(
			togglePinnedNavigationPath(
				['/erp/receipts', '/reports'],
				'/erp/receipts',
			),
		).toEqual(['/reports'])
	})
})
