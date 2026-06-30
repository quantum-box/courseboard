import type { Session } from 'next-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fetchTenants from './tenantFetcher'
import {
	TenantPathNotFoundError,
	findTenantByPathSegment,
	isTenantUlid,
	resolveTenantOperatorId,
	resolveTenantPathSegment,
} from './tenantPath'

vi.mock('./tenantFetcher', () => ({
	default: vi.fn(),
}))

const session = {
	accessToken: 'access-token',
} as Session

const fetchTenantsMock = vi.mocked(fetchTenants)

describe('tenant path resolution', () => {
	beforeEach(() => {
		fetchTenantsMock.mockReset()
	})

	it('detects tenant ULID path segments', () => {
		expect(isTenantUlid('tn_01j91h09tpj5ehwbwfwfxpak2b')).toBe(true)
		expect(isTenantUlid('restaurant-demo')).toBe(false)
	})

	it('matches accessible tenants by either id or slug', () => {
		const tenants = [
			{
				id: 'tn_01j91h09tpj5ehwbwfwfxpak2b',
				name: 'Production',
				slug: 'production-store',
				mode: 'production' as const,
			},
		]

		expect(
			findTenantByPathSegment(tenants, 'tn_01j91h09tpj5ehwbwfwfxpak2b')?.id,
		).toBe('tn_01j91h09tpj5ehwbwfwfxpak2b')
		expect(findTenantByPathSegment(tenants, 'production-store')?.id).toBe(
			'tn_01j91h09tpj5ehwbwfwfxpak2b',
		)
	})

	it('resolves slug paths to the same tenant id used by ULID paths', async () => {
		fetchTenantsMock.mockResolvedValueOnce([
			{
				id: 'tn_01j91h09tpj5ehwbwfwfxpak2b',
				name: 'Production',
				slug: 'production-store',
				mode: 'production',
			},
		])

		await expect(
			resolveTenantOperatorId(session, 'production-store'),
		).resolves.toBe('tn_01j91h09tpj5ehwbwfwfxpak2b')
		await expect(
			resolveTenantPathSegment(session, 'tn_01j91h09tpj5ehwbwfwfxpak2b'),
		).resolves.toMatchObject({
			id: 'tn_01j91h09tpj5ehwbwfwfxpak2b',
		})
	})

	it('returns null for an unknown slug so callers can render 404', async () => {
		fetchTenantsMock.mockResolvedValue([])

		await expect(
			resolveTenantPathSegment(session, 'missing-store'),
		).resolves.toBeNull()
		await expect(
			resolveTenantOperatorId(session, 'missing-store'),
		).rejects.toBeInstanceOf(TenantPathNotFoundError)
	})
})
