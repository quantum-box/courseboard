import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from '@storybook/test'
import { SalesAnalyticsV2Dashboard } from './sales-analytics-v2-dashboard'

const meta = {
	title: 'Features/SalesAnalyticsV2Dashboard',
	component: SalesAnalyticsV2Dashboard,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs', 'analytics', 'interactive'],
	decorators: [
		Story => (
			<div className='min-h-screen bg-background p-6'>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SalesAnalyticsV2Dashboard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		dashboard: {
			summary: {
				totalRevenueNanodollar: '125000000000',
				grossProfitNanodollar: '125000000000',
				grossMarginPercent: 100,
				orderCount: 84,
				unitsSold: 146,
				averageOrderValueNanodollar: '1488095238',
				inventoryTurnover: 1.82,
			},
			channelRows: [
				{
					channel: 'web',
					totalRevenueNanodollar: '95000000000',
					grossProfitNanodollar: '95000000000',
					orderCount: 64,
					unitsSold: 112,
					grossMarginPercent: 100,
				},
				{
					channel: 'store',
					totalRevenueNanodollar: '30000000000',
					grossProfitNanodollar: '30000000000',
					orderCount: 20,
					unitsSold: 34,
					grossMarginPercent: 100,
				},
			],
			skuRows: [
				{
					productId: 'prod_01',
					productName: 'Starter Beans',
					totalRevenueNanodollar: '52000000000',
					grossProfitNanodollar: '52000000000',
					totalQuantity: 72,
					currentStockQuantity: 110,
					inventoryTurnover: 0.65,
				},
			],
			exportColumns: [
				{ key: 'product_id', label: 'SKU' },
				{
					key: 'total_revenue_nanodollar',
					label: 'Revenue',
					unit: 'nanodollar',
				},
			],
		},
		customerRows: [
			{
				customerKey: 'buyer@example.com',
				customerName: 'buyer@example.com',
				customerKind: 'email',
				salesChannel: 'web',
				totalNanodollar: '45000000000',
				orderCount: 12,
			},
		],
		channelRows: [
			{
				channel: 'web',
				label: 'Web',
				totalNanodollar: '95000000000',
				orderCount: 64,
				sharePercent: 76,
			},
			{
				channel: 'store',
				label: 'Store',
				totalNanodollar: '30000000000',
				orderCount: 20,
				sharePercent: 24,
			},
		],
		reportContext: {
			from: '2026-05-01',
			to: '2026-05-31',
			channel: 'all',
			sku: '',
			customerSegment: 'all',
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)

		await userEvent.click(
			canvas.getByRole('tab', { name: 'Channel Breakdown' }),
		)

		await waitFor(() => {
			expect(canvas.getByText('76.0%')).toBeInTheDocument()
			expect(canvas.getByRole('cell', { name: 'B2B' })).toBeInTheDocument()
			expect(
				canvas.getByRole('cell', { name: 'Wholesale' }),
			).toBeInTheDocument()
		})
	},
}
