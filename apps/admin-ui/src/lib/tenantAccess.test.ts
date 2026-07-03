import type { Session } from 'next-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fetchTenants, {
	getPartialTenantFetchTenants,
	isTenantFetchUnauthorized,
} from './tenantFetcher'
import {
	type TenantAccessResult,
	decideTenantAccessOutcome,
	resolveTenantAccess,
} from './tenantAccess'

vi.mock('./tenantFetcher', () => ({
	default: vi.fn(),
	getPartialTenantFetchTenants: vi.fn(),
	isTenantFetchUnauthorized: vi.fn(),
}))

const session = {
	accessToken: 'access-token',
} as Session

const fetchTenantsMock = vi.mocked(fetchTenants)
const getPartialTenantFetchTenantsMock = vi.mocked(getPartialTenantFetchTenants)
const isTenantFetchUnauthorizedMock = vi.mocked(isTenantFetchUnauthorized)

describe('resolveTenantAccess', () => {
	beforeEach(() => {
		fetchTenantsMock.mockReset()
		getPartialTenantFetchTenantsMock.mockReset()
		isTenantFetchUnauthorizedMock.mockReset()
		getPartialTenantFetchTenantsMock.mockReturnValue(undefined)
		isTenantFetchUnauthorizedMock.mockReturnValue(false)
	})

	it('allows tenants returned by the accessible tenant list', async () => {
		fetchTenantsMock.mockResolvedValueOnce([
			{ id: 'tn_allowed', name: 'Allowed', mode: 'production' },
		])

		await expect(resolveTenantAccess(session, 'tn_allowed')).resolves.toEqual({
			status: 'allowed',
		})
	})

	it('allows session tenant ids without fetching the tenant list again', async () => {
		await expect(
			resolveTenantAccess(
				{
					...session,
					user: {
						tenants: ['tn_allowed'],
					},
				} as Session,
				'tn_allowed',
			),
		).resolves.toEqual({
			status: 'allowed',
		})

		expect(fetchTenantsMock).not.toHaveBeenCalled()
	})

	it('forbids missing session tenant ids without fetching the tenant list again', async () => {
		await expect(
			resolveTenantAccess(
				{
					...session,
					user: {
						tenants: ['tn_allowed'],
					},
				} as Session,
				'tn_other',
			),
		).resolves.toEqual({
			status: 'forbidden',
		})

		expect(fetchTenantsMock).not.toHaveBeenCalled()
	})

	it('forbids URL tenants outside the accessible tenant list', async () => {
		fetchTenantsMock.mockResolvedValueOnce([
			{ id: 'tn_allowed', name: 'Allowed', mode: 'production' },
		])

		await expect(resolveTenantAccess(session, 'tn_other')).resolves.toEqual({
			status: 'forbidden',
		})
	})

	it('marks unauthorized tenant fetches as expired sessions', async () => {
		const error = new Error('unauthorized')
		fetchTenantsMock.mockRejectedValueOnce(error)
		isTenantFetchUnauthorizedMock.mockReturnValueOnce(true)

		await expect(resolveTenantAccess(session, 'tn_allowed')).resolves.toEqual({
			status: 'expired',
		})
	})

	it('allows tenants found in partial tenant fetch results', async () => {
		const error = new Error('Failed to fetch tenants: 502 Bad Gateway')
		fetchTenantsMock.mockRejectedValueOnce(error)
		getPartialTenantFetchTenantsMock.mockReturnValueOnce([
			{ id: 'tn_allowed', name: 'Allowed', mode: 'production' },
		])

		await expect(resolveTenantAccess(session, 'tn_allowed')).resolves.toEqual({
			status: 'allowed',
		})
		expect(isTenantFetchUnauthorizedMock).not.toHaveBeenCalled()
	})

	it('does not forbid tenants missing from partial tenant fetch results', async () => {
		const error = new Error('Failed to fetch tenants: 502 Bad Gateway')
		fetchTenantsMock.mockRejectedValueOnce(error)
		getPartialTenantFetchTenantsMock.mockReturnValueOnce([
			{ id: 'tn_other', name: 'Other', mode: 'production' },
		])

		await expect(resolveTenantAccess(session, 'tn_allowed')).resolves.toEqual({
			status: 'unavailable',
			message: 'Failed to fetch tenants: 502 Bad Gateway',
		})
		expect(isTenantFetchUnauthorizedMock).not.toHaveBeenCalled()
	})

	it('marks non-authorization fetch failures as unavailable', async () => {
		const error = new Error('upstream down')
		fetchTenantsMock.mockRejectedValueOnce(error)
		isTenantFetchUnauthorizedMock.mockReturnValueOnce(false)

		await expect(resolveTenantAccess(session, 'tn_allowed')).resolves.toEqual({
			status: 'unavailable',
			message: 'upstream down',
		})
	})
})

// PLT-2253 §D2: authN failed=401(sign_out redirect) / authZ failed=403(in-page,
// no login redirect) の契約を回帰として lock する。
describe('decideTenantAccessOutcome (401/403 contract)', () => {
	it('allows access when the tenant is in the accessible list', () => {
		expect(decideTenantAccessOutcome({ status: 'allowed' })).toEqual({
			kind: 'allow',
		})
	})

	it('maps forbidden to a 403 deny that does not redirect to login', () => {
		const outcome = decideTenantAccessOutcome({ status: 'forbidden' })

		expect(outcome).toEqual({ kind: 'deny', httpStatus: 403 })
		// authZ failed は 403。authN(reauth/redirect) に寄せない不変条件。
		expect(outcome.kind).not.toBe('reauth')
	})

	it('maps expired to a 401 reauth that redirects to sign_out', () => {
		expect(decideTenantAccessOutcome({ status: 'expired' })).toEqual({
			kind: 'reauth',
			httpStatus: 401,
			redirectTo: 'sign_out',
			reason: 'expired',
		})
	})

	it('passes through the message for unavailable upstreams', () => {
		expect(
			decideTenantAccessOutcome({
				status: 'unavailable',
				message: 'tenant check failed',
			}),
		).toEqual({ kind: 'unavailable', message: 'tenant check failed' })
	})

	it('covers every TenantAccessResult status', () => {
		const statuses: TenantAccessResult[] = [
			{ status: 'allowed' },
			{ status: 'forbidden' },
			{ status: 'expired' },
			{ status: 'unavailable', message: 'x' },
		]

		for (const result of statuses) {
			expect(() => decideTenantAccessOutcome(result)).not.toThrow()
		}
	})
})
