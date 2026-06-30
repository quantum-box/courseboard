import { authWithCheck } from 'app/auth'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { type DailySalesPoint, DailySalesChart } from './daily-sales-chart'
import {
	type MonthlySalesPoint,
	MonthlySalesChart,
} from './monthly-sales-chart'
import {
	type ChannelSalesRow,
	type CustomerSalesRow,
	type SalesAnalyticsV2DashboardData,
	SalesAnalyticsV2Dashboard,
} from './sales-analytics-v2-dashboard'
import {
	classifySalesAnalyticsLoadFailure,
	type LoadFailureKind,
	salesAnalyticsLoadFailureMessage,
} from './sales-analytics-load-failure'
import { type TopSkuRow, TopSkusTable } from './top-skus-table'

export async function AnalyticsCharts({
	tenant,
	from,
	to,
	monthFrom,
	monthTo,
	channel,
	sku,
	customerSegment,
}: {
	tenant: string
	from: string
	to: string
	monthFrom: string
	monthTo: string
	channel: string
	sku: string
	customerSegment: string
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)

	let daily: DailySalesPoint[] = []
	let monthly: MonthlySalesPoint[] = []
	let topSkus: TopSkuRow[] = []
	let customerRows: CustomerSalesRow[] = []
	let channelRows: ChannelSalesRow[] = []
	let dashboard: SalesAnalyticsV2DashboardData | null = null
	let loadFailureKind: LoadFailureKind | null = null
	const reportContext = {
		from,
		to,
		channel,
		sku,
		customerSegment,
	}

	try {
		const normalizedChannel = channel === 'all' ? null : channel
		const [
			dailyRes,
			monthlyRes,
			topSkusRes,
			customerSalesRes,
			channelSalesRes,
			dashboardRes,
		] = await Promise.all([
			sdk.getDailySales({ from, to }),
			sdk.getMonthlySales({ from: monthFrom, to: monthTo }),
			sdk.getTopSkus({ from, to, limit: 10 }),
			sdk.getCustomerSales({
				from,
				to,
				channel: normalizedChannel,
				limit: 10,
				offset: 0,
			}),
			sdk.getChannelSales({
				from,
				to,
			}),
			sdk.getSalesAnalyticsV2Dashboard({
				from,
				to,
				channel: normalizedChannel,
				sku: sku === '' ? null : sku,
				customerSegment: customerSegment === 'all' ? null : customerSegment,
			}),
		])
		daily = dailyRes.dailySales ?? []
		monthly = monthlyRes.monthlySales ?? []
		topSkus = topSkusRes.topSkus ?? []
		customerRows = customerSalesRes.customerSales ?? []
		const rawChannelRows = channelSalesRes.channelSales ?? []
		const channelTotal = rawChannelRows.reduce(
			(sum, row) => sum + Number(row.totalNanodollar || 0),
			0,
		)
		channelRows = rawChannelRows.map(row => ({
			channel: row.salesChannel,
			label: row.salesChannelDetail
				? `${row.salesChannel} / ${row.salesChannelDetail}`
				: row.salesChannel,
			totalNanodollar: row.totalNanodollar,
			orderCount: row.orderCount,
			sharePercent:
				channelTotal > 0
					? (Number(row.totalNanodollar || 0) / channelTotal) * 100
					: 0,
		}))
		dashboard = dashboardRes.salesAnalyticsV2Dashboard ?? null
	} catch (error) {
		loadFailureKind = classifySalesAnalyticsLoadFailure(error)
	}

	return (
		<div className='flex flex-col gap-4'>
			{loadFailureKind ? (
				<div className='rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'>
					{salesAnalyticsLoadFailureMessage(loadFailureKind)}
				</div>
			) : null}
			{dashboard ? (
				<SalesAnalyticsV2Dashboard
					dashboard={dashboard}
					customerRows={customerRows}
					channelRows={channelRows}
					reportContext={reportContext}
				/>
			) : null}
			<DailySalesChart points={daily} />
			<MonthlySalesChart points={monthly} />
			<TopSkusTable rows={topSkus} />
		</div>
	)
}
