import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('app/auth', () => ({
	authWithCheck: vi.fn().mockResolvedValue({ accessToken: 'access-token' }),
}))

vi.mock('lib/runtime-env', () => ({
	getRuntimeEnv: (name: string) =>
		name === 'NEXT_PUBLIC_PLATFORM_ID' ? 'tn_platform' : undefined,
}))

vi.mock('lib/serverBackendUrl', () => ({
	getServerBackendBaseUrl: () => 'https://tachyon-field-api.test',
	joinServerBackendPath: (path: string) =>
		`https://tachyon-field-api.test${path.startsWith('/') ? path : `/${path}`}`,
}))

describe('SaaS subscription actions', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	})

	it('fetches workspace data and maps API field names to the view model contract', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith('/v1/erp/saas-subscriptions')) {
				return Response.json({
					items: [
						{
							id: 'sub_1',
							serviceName: 'Accounting Cloud',
							ownerTeam: 'Finance',
							currentPlan: 'standard',
							nextPlan: null,
							status: 'renewal_review',
							monthlyAmountYen: 12000,
							billingCycle: 'monthly',
							renewalDate: '2026-07-31',
							seats: 8,
							reason: 'monthly close',
							approvalState: 'needs_review',
						},
					],
					summary: {
						subscriptionCount: 1,
						monthlyTotalYen: 12000,
						pendingDeltaYen: -3000,
						renewalReviewCount: 1,
					},
				})
			}
			if (url.endsWith('/v1/erp/saas-subscription-requests')) {
				return Response.json({
					items: [
						{
							id: 'req_1',
							subscriptionId: null,
							serviceName: 'Planning Suite',
							requester: 'Ops',
							changeType: 'new',
							fromPlan: null,
							toPlan: 'team',
							reason: 'field rollout',
							requestedAt: '2026-06-18T00:00:00Z',
							estimatedDeltaYen: 5000,
							approver: 'CEO',
							state: 'waiting_approval',
						},
					],
				})
			}
			return new Response('unexpected url', { status: 404 })
		})
		vi.stubGlobal('fetch', fetchMock)

		const { fetchSaasSubscriptionWorkspaceAction } = await import('./action')
		const result = await fetchSaasSubscriptionWorkspaceAction('tn_operator')

		expect(result).toEqual({
			success: true,
			data: {
				subscriptions: [
					{
						id: 'sub_1',
						serviceName: 'Accounting Cloud',
						ownerTeam: 'Finance',
						currentPlan: 'standard',
						nextPlan: undefined,
						status: 'renewal_review',
						monthlyAmount: 12000,
						billingCycle: 'monthly',
						renewalDate: '2026-07-31',
						seats: 8,
						reason: 'monthly close',
						approvalState: 'needs_review',
					},
				],
				requests: [
					{
						id: 'req_1',
						subscriptionId: undefined,
						serviceName: 'Planning Suite',
						requester: 'Ops',
						changeType: 'new',
						fromPlan: undefined,
						toPlan: 'team',
						reason: 'field rollout',
						requestedAt: '2026-06-18T00:00:00Z',
						estimatedDelta: 5000,
						approver: 'CEO',
						state: 'waiting_approval',
					},
				],
				summary: {
					subscriptionCount: 1,
					monthlyTotalYen: 12000,
					pendingDeltaYen: -3000,
					renewalReviewCount: 1,
				},
			},
		})
		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/erp/saas-subscriptions',
			expect.objectContaining({
				cache: 'no-store',
				headers: expect.objectContaining({
					Authorization: 'Bearer access-token',
					'Content-Type': 'application/json',
					'x-operator-id': 'tn_operator',
					'x-platform-id': 'tn_platform',
				}),
			}),
		)
	})

	it('posts change requests with the submitted boundary payload', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				id: 'req_2',
				subscriptionId: 'sub_1',
				serviceName: 'Accounting Cloud',
				requester: 'Ops',
				changeType: 'plan_change',
				fromPlan: 'standard',
				toPlan: 'lite',
				reason: 'cost control',
				requestedAt: '2026-06-18T00:00:00Z',
				estimatedDeltaYen: -3000,
				approver: 'CPO',
				state: 'waiting_approval',
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const { createSaasChangeRequestAction } = await import('./action')
		const result = await createSaasChangeRequestAction('tn_operator', {
			subscriptionId: 'sub_1',
			serviceName: 'Accounting Cloud',
			changeType: 'plan_change',
			fromPlan: 'standard',
			toPlan: 'lite',
			reason: 'cost control',
			estimatedDeltaYen: -3000,
			approver: 'CPO',
		})

		expect(result.data).toMatchObject({
			id: 'req_2',
			subscriptionId: 'sub_1',
			estimatedDelta: -3000,
		})
		expect(fetchMock).toHaveBeenCalledWith(
			'https://tachyon-field-api.test/v1/erp/saas-subscription-requests',
			expect.objectContaining({
				body: JSON.stringify({
					subscriptionId: 'sub_1',
					serviceName: 'Accounting Cloud',
					changeType: 'plan_change',
					fromPlan: 'standard',
					toPlan: 'lite',
					reason: 'cost control',
					estimatedDeltaYen: -3000,
					approver: 'CPO',
				}),
				method: 'POST',
			}),
		)
	})
})
