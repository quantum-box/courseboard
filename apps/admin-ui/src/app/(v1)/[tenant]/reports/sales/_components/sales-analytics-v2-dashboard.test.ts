import { describe, expect, it } from 'vitest'
import { classifySalesAnalyticsLoadFailure } from './sales-analytics-load-failure'
import {
	buildSalesAnalyticsHealthSummary,
	type SalesAnalyticsV2DashboardData,
} from './sales-analytics-v2-dashboard'

const dashboard = (
	overrides: Partial<SalesAnalyticsV2DashboardData> = {},
): SalesAnalyticsV2DashboardData => ({
	summary: {
		totalRevenueNanodollar: '0',
		grossProfitNanodollar: '0',
		orderCount: 0,
		unitsSold: 0,
	},
	channelRows: [],
	skuRows: [],
	exportColumns: [],
	...overrides,
})

describe('buildSalesAnalyticsHealthSummary', () => {
	it('marks report coverage as incomplete when analytics payloads are empty', () => {
		expect(buildSalesAnalyticsHealthSummary(dashboard())).toEqual({
			hasRevenue: false,
			hasChannelBreakdown: false,
			hasSkuBreakdown: false,
			hasCustomerBreakdown: false,
			exportColumnCount: 0,
		})
	})

	it('combines dashboard, channel, customer, and export coverage', () => {
		const summary = buildSalesAnalyticsHealthSummary(
			dashboard({
				summary: {
					totalRevenueNanodollar: '1000000000',
					grossProfitNanodollar: '250000000',
					orderCount: 2,
					unitsSold: 4,
				},
				skuRows: [
					{
						productId: 'prod_1',
						productName: 'Coffee',
						totalRevenueNanodollar: '1000000000',
						grossProfitNanodollar: '250000000',
						totalQuantity: 4,
						currentStockQuantity: 10,
					},
				],
				exportColumns: [{ key: 'product_id', label: 'SKU' }],
			}),
			[
				{
					customerKey: 'buyer@example.com',
					totalNanodollar: '1000000000',
					orderCount: 2,
				},
			],
			[
				{
					channel: 'web',
					label: 'Web',
					totalNanodollar: '1000000000',
					orderCount: 2,
					sharePercent: 100,
				},
			],
		)

		expect(summary).toEqual({
			hasRevenue: true,
			hasChannelBreakdown: true,
			hasSkuBreakdown: true,
			hasCustomerBreakdown: true,
			exportColumnCount: 1,
		})
	})
})

describe('classifySalesAnalyticsLoadFailure', () => {
	it('separates permission, API availability, and generic API failures', () => {
		expect(
			classifySalesAnalyticsLoadFailure({ response: { status: 403 } }),
		).toBe('permission')
		expect(
			classifySalesAnalyticsLoadFailure(new Error('fetch failed')),
		).toBe('unavailable')
		expect(classifySalesAnalyticsLoadFailure(new Error('GraphQL error'))).toBe(
			'error',
		)
	})
})
