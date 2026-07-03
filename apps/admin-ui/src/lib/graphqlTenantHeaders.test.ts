import type { Session } from 'next-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTenantHeaderResolver } from './graphqlTenantHeaders'
import { PLATFORM_IDS } from './mode'
import { resolveTenantOperatorId } from './tenantPath'

vi.mock('./tenantPath', async importOriginal => {
	const actual = await importOriginal<typeof import('./tenantPath')>()
	return {
		...actual,
		resolveTenantOperatorId: vi.fn(),
	}
})

const resolveTenantOperatorIdMock = vi.mocked(resolveTenantOperatorId)

const session = {
	accessToken: 'session-access-token',
} as Session

describe('createTenantHeaderResolver', () => {
	beforeEach(() => {
		resolveTenantOperatorIdMock.mockReset()
	})

	it('leaves ULID tenant headers unchanged', async () => {
		const headers = {
			'x-platform-id': PLATFORM_IDS.production,
			'x-operator-id': 'tn_01j91h09tpj5ehwbwfwfxpak2b',
			Authorization: 'Bearer session-access-token',
		}

		await expect(createTenantHeaderResolver(session)(headers)).resolves.toBe(
			headers,
		)
		expect(resolveTenantOperatorIdMock).not.toHaveBeenCalled()
	})

	it('resolves slug tenant headers before GraphQL fetch reaches verify_user', async () => {
		resolveTenantOperatorIdMock.mockResolvedValueOnce(
			'tn_01j91h09tpj5ehwbwfwfxpak2b',
		)
		const headers = {
			'x-platform-id': PLATFORM_IDS.production,
			'x-operator-id': 'production-store',
			Authorization: 'Bearer session-access-token',
		}

		await expect(createTenantHeaderResolver(session)(headers)).resolves.toEqual(
			{
				...headers,
				'x-operator-id': 'tn_01j91h09tpj5ehwbwfwfxpak2b',
			},
		)
		expect(resolveTenantOperatorIdMock).toHaveBeenCalledWith(
			expect.objectContaining({ accessToken: 'session-access-token' }),
			'production-store',
		)
	})
})
