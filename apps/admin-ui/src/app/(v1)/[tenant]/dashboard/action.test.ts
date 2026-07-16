import { beforeEach, describe, expect, it, vi } from 'vitest'

const getConsumerOrdersForAdmin = vi.fn()
const listStockLevels = vi.fn()
const listLowStockAlerts = vi.fn()

vi.mock('app/auth', () => ({
	authWithCheck: vi.fn(async () => ({
		accessToken: 'access-token',
		user: { role: 'OWNER' },
	})),
}))

vi.mock('lib/graphqlClient', () => ({
	getGraphqlSdk: vi.fn(() => ({
		getConsumerOrdersForAdmin,
	})),
}))

vi.mock('../procurement/_lib/erp-api', () => ({
	listStockLevels,
	listLowStockAlerts,
}))

describe('fetchHomeDashboardAction', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		getConsumerOrdersForAdmin.mockReset()
		listStockLevels.mockReset()
		listLowStockAlerts.mockReset()
	})

	it('uses API data and does not fabricate values when a source fails', async () => {
		const { fetchHomeDashboardAction } = await import('./action')
		const orderCreatedAt = new Date().toISOString()
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					period: new Date().toISOString().slice(0, 10),
					summary: {
						totalSales: 1200,
						squareSales: 700,
						invoiceSales: 500,
						unpaidInvoiceCount: 0,
						unpaidInvoiceAmount: 0,
						newCustomersThisMonth: 0,
					},
					monthlySales: [],
					pipelineRows: [],
					recentTransactions: [],
				}),
			),
		)
		getConsumerOrdersForAdmin.mockResolvedValue({
			consumerOrders: {
				items: [
					{
						id: 'co_1',
						status: 'confirmed',
						fulfillmentMethod: 'pickup',
						customerId: 'cus_1',
						createdAt: orderCreatedAt,
					},
				],
			},
		})
		listStockLevels.mockResolvedValue({ items: [], source: 'api' })
		listLowStockAlerts.mockRejectedValue(new Error('forbidden'))

		const dashboard = await fetchHomeDashboardAction('tenant_1', 'today')

		expect(dashboard.metrics.salesJpy.value).toBe(1200)
		expect(dashboard.metrics.orderCount.value).toBe(1)
		expect(dashboard.metrics.bopisPending.value).toBe(1)
		expect(dashboard.metrics.newCustomers.value).toBe(1)
		expect(dashboard.metrics.inventoryAlerts.value).toBeNull()
		expect(dashboard.metrics.inventoryAlerts.error).toBe(
			'在庫アラートを取得できませんでした',
		)
		expect(dashboard.errors).toEqual([
			'在庫アラートを取得できませんでした: forbidden',
		])
	})

	it('treats a missing commerce order source as an unconfigured optional metric', async () => {
		const { fetchHomeDashboardAction } = await import('./action')
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					period: '2026-05-29',
					summary: {
						totalSales: 1200,
						squareSales: 700,
						invoiceSales: 500,
						unpaidInvoiceCount: 0,
						unpaidInvoiceAmount: 0,
						newCustomersThisMonth: 0,
					},
					monthlySales: [],
					pipelineRows: [],
					recentTransactions: [],
				}),
			),
		)
		getConsumerOrdersForAdmin.mockRejectedValue(
			new Error('Commerce API error (404):'),
		)
		listStockLevels.mockResolvedValue({ items: [], source: 'api' })
		listLowStockAlerts.mockResolvedValue({ items: [] })

		const dashboard = await fetchHomeDashboardAction('tenant_1', 'today')

		expect(dashboard.metrics.orderCount).toEqual({
			value: null,
			error: '注文連携が未設定です',
		})
		expect(dashboard.metrics.bopisPending).toEqual({
			value: null,
			error: '注文連携が未設定です',
		})
		expect(dashboard.metrics.newCustomers).toEqual({
			value: null,
			error: '注文連携が未設定です',
		})
		expect(dashboard.errors).toEqual([])
	})

	it('treats an HTTP 404 from the orders endpoint as an unconfigured optional metric', async () => {
		const { fetchHomeDashboardAction } = await import('./action')
		const { ReliableFetchError } = await import('lib/reliable-fetch')
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					period: '2026-05-29',
					summary: {
						totalSales: 1200,
						squareSales: 700,
						invoiceSales: 500,
						unpaidInvoiceCount: 0,
						unpaidInvoiceAmount: 0,
						newCustomersThisMonth: 0,
					},
					monthlySales: [],
					pipelineRows: [],
					recentTransactions: [],
				}),
			),
		)
		getConsumerOrdersForAdmin.mockRejectedValue(
			new ReliableFetchError({
				kind: 'unknown',
				status: 404,
				message: 'データ取得に失敗しました (HTTP 404)',
				retryable: false,
				attempts: 1,
			}),
		)
		listStockLevels.mockResolvedValue({ items: [], source: 'api' })
		listLowStockAlerts.mockResolvedValue({ items: [] })

		const dashboard = await fetchHomeDashboardAction('tenant_1', 'today')

		expect(dashboard.metrics.orderCount).toEqual({
			value: null,
			error: '注文連携が未設定です',
		})
		expect(dashboard.errors).toEqual([])
	})

	it('does not expose Tachyon auth response details in dashboard errors', async () => {
		const { fetchHomeDashboardAction } = await import('./action')
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					period: '2026-06-09',
					summary: {
						totalSales: 0,
						squareSales: 0,
						invoiceSales: 0,
						unpaidInvoiceCount: 0,
						unpaidInvoiceAmount: 0,
						newCustomersThisMonth: 0,
					},
					monthlySales: [],
					pipelineRows: [],
					recentTransactions: [],
				}),
			),
		)
		getConsumerOrdersForAdmin.mockRejectedValue(
			new Error(
				'Unauthorized: Tachyon auth evaluate_policies_batch rejected the request: {"response":{"errors":[{"message":"secret detail"}]}}',
			),
		)
		listStockLevels.mockResolvedValue({ items: [], source: 'api' })
		listLowStockAlerts.mockResolvedValue({ items: [] })

		const dashboard = await fetchHomeDashboardAction('tenant_1', 'today')

		expect(dashboard.metrics.orderCount).toEqual({
			value: null,
			error: '注文連携が未設定です',
		})
		expect(dashboard.errors).toEqual([])
		expect(dashboard.errors.join('\n')).not.toContain('evaluate_policies_batch')
	})
})
