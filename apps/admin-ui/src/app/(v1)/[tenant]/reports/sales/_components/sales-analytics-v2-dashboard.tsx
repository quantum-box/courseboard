import { Badge } from 'components/ui/badge'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import { formatNanodollarAsUsd } from 'lib/format-price'

export type SalesAnalyticsV2DashboardData = {
	summary: {
		totalRevenueNanodollar: string
		grossProfitNanodollar: string
		grossMarginPercent?: number | null
		orderCount: number
		unitsSold: number
		averageOrderValueNanodollar?: string | null
		inventoryTurnover?: number | null
	}
	channelRows: Array<{
		channel: string
		totalRevenueNanodollar: string
		grossProfitNanodollar: string
		orderCount: number
		unitsSold: number
		grossMarginPercent?: number | null
	}>
	skuRows: Array<{
		productId: string
		productName: string
		totalRevenueNanodollar: string
		grossProfitNanodollar: string
		totalQuantity: number
		currentStockQuantity: number
		inventoryTurnover?: number | null
	}>
	exportColumns: Array<{
		key: string
		label: string
		unit?: string | null
	}>
}

export type CustomerSalesRow = {
	customerKey: string
	customerId?: string | null
	customerName?: string | null
	customerKind?: string | null
	salesChannel?: string | null
	salesChannelDetail?: string | null
	totalNanodollar: string
	orderCount: number
	firstOrderDate?: string | null
	lastOrderDate?: string | null
}

export type ChannelSalesRow = {
	channel: string
	label: string
	totalNanodollar: string
	orderCount: number
	sharePercent: number
}

export type SalesAnalyticsReportContext = {
	from: string
	to: string
	channel: string
	sku: string
	customerSegment: string
}

export type SalesAnalyticsHealthSummary = {
	hasRevenue: boolean
	hasChannelBreakdown: boolean
	hasSkuBreakdown: boolean
	hasCustomerBreakdown: boolean
	exportColumnCount: number
}

export function buildSalesAnalyticsHealthSummary(
	dashboard: SalesAnalyticsV2DashboardData,
	customerRows: CustomerSalesRow[] = [],
	channelRows: ChannelSalesRow[] = [],
): SalesAnalyticsHealthSummary {
	return {
		hasRevenue: Number(dashboard.summary.totalRevenueNanodollar) > 0,
		hasChannelBreakdown:
			dashboard.channelRows.length > 0 || channelRows.length > 0,
		hasSkuBreakdown: dashboard.skuRows.length > 0,
		hasCustomerBreakdown: customerRows.length > 0,
		exportColumnCount: dashboard.exportColumns.length,
	}
}

function formatPercent(value: number | null | undefined): string {
	if (value == null) return '-'
	return `${value.toFixed(1)}%`
}

function formatRatio(value: number | null | undefined): string {
	if (value == null) return '-'
	return value.toFixed(2)
}

function channelLabel(value: string): string {
	switch (value) {
		case 'online_store':
		case 'online':
		case 'web':
			return 'Web'
		case 'store':
		case 'physical_store':
			return 'Store'
		case 'b2b':
			return 'B2B'
		case 'wholesale':
			return 'Wholesale'
		case 'marketplace':
			return 'Web'
		default:
			return value
	}
}

const CHANNEL_ORDER = ['web', 'store', 'b2b', 'wholesale'] as const

function normalizeChannelRows(rows: ChannelSalesRow[]): ChannelSalesRow[] {
	const byChannel = new Map(rows.map(row => [row.channel, row]))
	return CHANNEL_ORDER.map(channel => {
		const row = byChannel.get(channel)
		return (
			row ?? {
				channel,
				label: channelLabel(channel),
				totalNanodollar: '0',
				orderCount: 0,
				sharePercent: 0,
			}
		)
	})
}

function KpiCard({
	label,
	value,
	sub,
}: {
	label: string
	value: string
	sub: string
}) {
	return (
		<Card>
			<CardHeader className='pb-2'>
				<CardDescription>{label}</CardDescription>
				<CardTitle className='text-2xl tabular-nums'>{value}</CardTitle>
			</CardHeader>
			<CardContent>
				<p className='text-xs text-muted-foreground'>{sub}</p>
			</CardContent>
		</Card>
	)
}

function filterLabel(context: SalesAnalyticsReportContext): string {
	const filters = [
		context.channel === 'all'
			? null
			: `チャネル ${channelLabel(context.channel)}`,
		context.customerSegment === 'all'
			? null
			: `顧客 ${context.customerSegment === 'member' ? '会員' : 'ゲスト'}`,
		context.sku ? `SKU ${context.sku}` : null,
	].filter((item): item is string => item !== null)

	return filters.length > 0 ? filters.join(' / ') : 'フィルタなし'
}

function HealthBadge({
	ok,
	label,
}: {
	ok: boolean
	label: string
}) {
	return (
		<Badge variant={ok ? 'default' : 'secondary'} className='whitespace-nowrap'>
			{label}
		</Badge>
	)
}

function SalesAnalyticsOperationsCard({
	context,
	health,
}: {
	context: SalesAnalyticsReportContext
	health: SalesAnalyticsHealthSummary
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>運用チェック</CardTitle>
				<CardDescription>
					表示中の集計条件と、レポートに使える分析データの充足状況です。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className='grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1fr)]'>
					<div className='space-y-2 text-sm'>
						<div>
							<span className='text-muted-foreground'>対象期間</span>
							<div className='font-medium tabular-nums'>
								{context.from} - {context.to}
							</div>
						</div>
						<div>
							<span className='text-muted-foreground'>絞り込み</span>
							<div className='font-medium'>{filterLabel(context)}</div>
						</div>
					</div>
					<div className='flex flex-wrap content-start gap-2'>
						<HealthBadge ok={health.hasRevenue} label='KPI売上' />
						<HealthBadge ok={health.hasChannelBreakdown} label='チャネル別' />
						<HealthBadge ok={health.hasSkuBreakdown} label='SKU別' />
						<HealthBadge ok={health.hasCustomerBreakdown} label='顧客別' />
						<HealthBadge
							ok={health.exportColumnCount > 0}
							label={`Export列 ${health.exportColumnCount}`}
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function ChannelBreakdownChart({ rows }: { rows: ChannelSalesRow[] }) {
	const normalizedRows = normalizeChannelRows(rows)

	return (
		<Card>
			<CardHeader>
				<CardTitle>Channel Breakdown</CardTitle>
				<CardDescription>
					web / store / b2b / wholesale の売上構成比を表示します。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]'>
					<div className='space-y-4'>
						{normalizedRows.map(row => (
							<div key={row.channel} className='space-y-2'>
								<div className='flex items-center justify-between gap-3 text-sm'>
									<span className='font-medium'>{row.label}</span>
									<span className='font-mono tabular-nums text-muted-foreground'>
										{row.sharePercent.toFixed(1)}%
									</span>
								</div>
								<div className='h-3 overflow-hidden rounded-sm bg-muted'>
									<div
										className='h-full rounded-sm bg-primary'
										style={{
											width: `${Math.min(Math.max(row.sharePercent, 0), 100)}%`,
										}}
									/>
								</div>
							</div>
						))}
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>チャネル</TableHead>
								<TableHead className='text-right'>売上</TableHead>
								<TableHead className='text-right'>注文</TableHead>
								<TableHead className='text-right'>構成比</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{normalizedRows.map(row => (
								<TableRow key={row.channel}>
									<TableCell className='font-medium'>{row.label}</TableCell>
									<TableCell className='text-right font-mono tabular-nums'>
										{formatNanodollarAsUsd(row.totalNanodollar)}
									</TableCell>
									<TableCell className='text-right tabular-nums'>
										{row.orderCount.toLocaleString()}
									</TableCell>
									<TableCell className='text-right tabular-nums'>
										{row.sharePercent.toFixed(1)}%
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	)
}

export function SalesAnalyticsV2Dashboard({
	dashboard,
	customerRows = [],
	channelRows = [],
	reportContext,
}: {
	dashboard: SalesAnalyticsV2DashboardData
	customerRows?: CustomerSalesRow[]
	channelRows?: ChannelSalesRow[]
	reportContext: SalesAnalyticsReportContext
}) {
	const { summary } = dashboard
	const health = buildSalesAnalyticsHealthSummary(
		dashboard,
		customerRows,
		channelRows,
	)

	return (
		<div className='flex flex-col gap-4'>
			<SalesAnalyticsOperationsCard context={reportContext} health={health} />
			<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
				<KpiCard
					label='売上'
					value={formatNanodollarAsUsd(summary.totalRevenueNanodollar)}
					sub={`${summary.orderCount.toLocaleString()}件 / ${summary.unitsSold.toLocaleString()}点`}
				/>
				<KpiCard
					label='粗利'
					value={formatNanodollarAsUsd(summary.grossProfitNanodollar)}
					sub={`粗利率 ${formatPercent(summary.grossMarginPercent)}`}
				/>
				<KpiCard
					label='平均注文単価'
					value={
						summary.averageOrderValueNanodollar
							? formatNanodollarAsUsd(summary.averageOrderValueNanodollar)
							: '-'
					}
					sub='確定注文の明細売上ベース'
				/>
				<KpiCard
					label='在庫回転'
					value={formatRatio(summary.inventoryTurnover)}
					sub='販売数量 / 現在庫数量'
				/>
			</div>

			<Tabs defaultValue='dashboard' className='space-y-4'>
				<TabsList>
					<TabsTrigger value='dashboard'>Dashboard</TabsTrigger>
					<TabsTrigger value='channels'>Channel Breakdown</TabsTrigger>
				</TabsList>
				<TabsContent value='dashboard'>
					<Card>
						<CardHeader>
							<CardTitle>チャネル別実績</CardTitle>
							<CardDescription>
								売上、粗利、注文数、販売数量をチャネルごとに比較します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>チャネル</TableHead>
										<TableHead className='text-right'>売上</TableHead>
										<TableHead className='text-right'>粗利</TableHead>
										<TableHead className='text-right'>粗利率</TableHead>
										<TableHead className='text-right'>注文</TableHead>
										<TableHead className='text-right'>数量</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{dashboard.channelRows.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={6}
												className='py-8 text-center text-sm text-muted-foreground'
											>
												対象期間に売上はありません。
											</TableCell>
										</TableRow>
									) : (
										dashboard.channelRows.map(row => (
											<TableRow key={row.channel}>
												<TableCell className='font-medium'>
													{channelLabel(row.channel)}
												</TableCell>
												<TableCell className='text-right font-mono tabular-nums'>
													{formatNanodollarAsUsd(row.totalRevenueNanodollar)}
												</TableCell>
												<TableCell className='text-right font-mono tabular-nums'>
													{formatNanodollarAsUsd(row.grossProfitNanodollar)}
												</TableCell>
												<TableCell className='text-right tabular-nums'>
													{formatPercent(row.grossMarginPercent)}
												</TableCell>
												<TableCell className='text-right tabular-nums'>
													{row.orderCount.toLocaleString()}
												</TableCell>
												<TableCell className='text-right tabular-nums'>
													{row.unitsSold.toLocaleString()}
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>
				<TabsContent value='channels'>
					<ChannelBreakdownChart rows={channelRows} />
				</TabsContent>
			</Tabs>

			<Card>
				<CardHeader>
					<CardTitle>顧客別実績</CardTitle>
					<CardDescription>
						顧客ID、メール、セッションの順に受注を束ねて売上を比較します。
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>顧客</TableHead>
								<TableHead className='hidden lg:table-cell'>キー</TableHead>
								<TableHead>チャネル</TableHead>
								<TableHead className='text-right'>売上</TableHead>
								<TableHead className='text-right'>注文</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{customerRows.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className='py-8 text-center text-sm text-muted-foreground'
									>
										対象期間に売上はありません。
									</TableCell>
								</TableRow>
							) : (
								customerRows.map(row => (
									<TableRow key={row.customerKey}>
										<TableCell>
											<div className='font-medium'>
												{row.customerName ?? row.customerId ?? row.customerKey}
											</div>
											<div className='text-xs text-muted-foreground'>
												{row.customerKind ?? '-'}
											</div>
										</TableCell>
										<TableCell className='hidden lg:table-cell font-mono text-xs text-muted-foreground'>
											{row.customerKey}
										</TableCell>
										<TableCell>
											<div>{channelLabel(row.salesChannel ?? '-')}</div>
											{row.salesChannelDetail ? (
												<div className='text-xs text-muted-foreground'>
													{row.salesChannelDetail}
												</div>
											) : null}
										</TableCell>
										<TableCell className='text-right font-mono tabular-nums'>
											{formatNanodollarAsUsd(row.totalNanodollar)}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{row.orderCount.toLocaleString()}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>SKU別実績</CardTitle>
					<CardDescription>
						売上、粗利、販売数量、現在庫、在庫回転を SKU ごとに比較します。
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>商品</TableHead>
								<TableHead className='hidden lg:table-cell'>SKU</TableHead>
								<TableHead className='text-right'>売上</TableHead>
								<TableHead className='text-right'>粗利</TableHead>
								<TableHead className='text-right'>数量</TableHead>
								<TableHead className='text-right'>在庫</TableHead>
								<TableHead className='text-right'>回転</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{dashboard.skuRows.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={7}
										className='py-8 text-center text-sm text-muted-foreground'
									>
										対象期間に売上はありません。
									</TableCell>
								</TableRow>
							) : (
								dashboard.skuRows.map(row => (
									<TableRow key={row.productId}>
										<TableCell className='font-medium'>
											{row.productName}
										</TableCell>
										<TableCell className='hidden lg:table-cell font-mono text-xs text-muted-foreground'>
											{row.productId}
										</TableCell>
										<TableCell className='text-right font-mono tabular-nums'>
											{formatNanodollarAsUsd(row.totalRevenueNanodollar)}
										</TableCell>
										<TableCell className='text-right font-mono tabular-nums'>
											{formatNanodollarAsUsd(row.grossProfitNanodollar)}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{row.totalQuantity.toLocaleString()}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{row.currentStockQuantity.toLocaleString()}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{formatRatio(row.inventoryTurnover)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Export列</CardTitle>
					<CardDescription>
						CSV/export 実装で使用する列キーと単位を API と同じ定義で表示します。
					</CardDescription>
				</CardHeader>
				<CardContent>
					{dashboard.exportColumns.length === 0 ? (
						<div className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
							Export列定義が返っていません。CSV/export を使う前に API contract
							を確認してください。
						</div>
					) : (
						<div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
							{dashboard.exportColumns.map(column => (
								<div
									key={column.key}
									className='rounded-md border px-3 py-2 text-sm'
								>
									<div className='font-medium'>{column.label}</div>
									<div className='font-mono text-xs text-muted-foreground'>
										{column.key}
										{column.unit ? ` / ${column.unit}` : ''}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
