import type { Session } from 'next-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPERATOR_IDS, OPERATOR_NAMES } from './mode'
import { getServerGraphqlSdk } from './serverGraphqlClient'
import { fetchTenantName } from './tenantName'

vi.mock('./serverGraphqlClient', () => ({
	getServerGraphqlSdk: vi.fn(),
}))

const session = {
	accessToken: 'access-token',
	user: { role: 'admin' },
} as unknown as Session

describe('fetchTenantName', () => {
	beforeEach(() => {
		vi.mocked(getServerGraphqlSdk).mockReset()
	})

	it('keeps the known operator display name without fetching remote tenant metadata', async () => {
		await expect(fetchTenantName(session, OPERATOR_IDS.production)).resolves.toBe(
			OPERATOR_NAMES.production,
		)
		expect(getServerGraphqlSdk).not.toHaveBeenCalled()
	})

	it('uses the GraphQL operator name for an operator tenant', async () => {
		vi.mocked(getServerGraphqlSdk).mockReturnValue({
			accountMenuContent: vi.fn().mockResolvedValue({
				operator: { operatorName: 'GraphQL Tenant', name: 'graphql-tenant' },
			}),
		} as never)

		await expect(fetchTenantName(session, 'tn_graphql')).resolves.toBe(
			'GraphQL Tenant',
		)
	})

	it('returns null when the target tenant name cannot be resolved', async () => {
		vi.mocked(getServerGraphqlSdk).mockReturnValue({
			accountMenuContent: vi.fn().mockRejectedValue(new Error('not found')),
		} as never)

		await expect(fetchTenantName(session, 'tn_missing')).resolves.toBeNull()
	})
})
