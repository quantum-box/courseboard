import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { PageHeader, PageToolbar } from 'components/ui/page-shell'
import { Skeleton } from 'components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import {
	BanknoteIcon,
	CalendarIcon,
	CircleDollarSignIcon,
	ReceiptTextIcon,
	UserPlusIcon,
} from 'lucide-react'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { fetchSalesDashboardAction } from './action'
import {
	MonthlySalesChart,
	PipelineAmountChart,
} from './_components/sales-dashboard-charts'

export const metadata = {
	title: '売上ダッシュボード | TACHYON Field',
	description: '月次売上、未入金、案件パイプラインを可視化します。',
}

type Preset = 'this-month' | 'last-month' | 'quarter' | 'custom'

function formatDate(date: Date) {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-')
}

function monthStart(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), 1)
}

function monthEnd(date: Date) {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function resolveRange(searchParams?: {
	preset?: string
	dateFrom?: string
	dateTo?: string
}) {
	const now = new Date()
	const preset = (searchParams?.preset ?? 'this-month') as Preset
	if (preset === 'custom' && searchParams?.dateFrom && searchParams?.dateTo) {
		return {
			preset,
			dateFrom: searchParams.dateFrom,
			dateTo: searchParams.dateTo,
		}
	}
	if (preset === 'last-month') {
		const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
		return {
			preset,
			dateFrom: formatDate(monthStart(lastMonth)),
			dateTo: formatDate(monthEnd(lastMonth)),
		}
	}
	if (preset === 'quarter') {
		const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
		return {
			preset,
			dateFrom: formatDate(new Date(now.getFullYear(), quarterStartMonth, 1)),
			dateTo: formatDate(now),
		}
	}
	return {
		preset: 'this-month' as Preset,
		dateFrom: formatDate(monthStart(now)),
		dateTo: formatDate(now),
	}
}

const jpy = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const numberFormat = new Intl.NumberFormat('ja-JP')

export default function SalesDashboardRoute({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams?: { preset?: string; dateFrom?: string; dateTo?: string }
}) {
	const mp = getServerModePrefix(tenant)
	const range = resolveRange(searchParams)

	return (
		<V1Layout
			current='sales-dashboard'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/home` as Route}>ホーム</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>売上ダッシュボード</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='space-y-6'>
					<PageHeader
						title='売上ダッシュボード'
						description='Square入金、ERP Invoice、CRM案件を期間別に集計します'
					/>
					<PageToolbar className='xl:items-end'>
						<div className='flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between'>
							<div className='flex flex-wrap gap-2'>
								<PresetLink
									tenant={tenant}
									modePrefix={mp}
									preset='this-month'
									active={range.preset === 'this-month'}
								>
									今月
								</PresetLink>
								<PresetLink
									tenant={tenant}
									modePrefix={mp}
									preset='last-month'
									active={range.preset === 'last-month'}
								>
									先月
								</PresetLink>
								<PresetLink
									tenant={tenant}
									modePrefix={mp}
									preset='quarter'
									active={range.preset === 'quarter'}
								>
									四半期
								</PresetLink>
							</div>
							<form
								className='grid gap-3 sm:grid-cols-[150px_150px_auto]'
								action={`${mp}/${tenant}/dashboard`}
							>
								<input type='hidden' name='preset' value='custom' />
								<div className='space-y-1'>
									<Label htmlFor='dateFrom'>開始日</Label>
									<Input
										id='dateFrom'
										name='dateFrom'
										type='date'
										defaultValue={range.dateFrom}
									/>
								</div>
								<div className='space-y-1'>
									<Label htmlFor='dateTo'>終了日</Label>
									<Input
										id='dateTo'
										name='dateTo'
										type='date'
										defaultValue={range.dateTo}
									/>
								</div>
								<Button className='self-end' type='submit'>
									<CalendarIcon className='mr-2 h-4 w-4' />
									適用
								</Button>
							</form>
						</div>
					</PageToolbar>

					<Suspense fallback={<SalesDashboardSkeleton />}>
						<SalesDashboardContent
							tenant={tenant}
							dateFrom={range.dateFrom}
							dateTo={range.dateTo}
						/>
					</Suspense>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

async function SalesDashboardContent({
	tenant,
	dateFrom,
	dateTo,
}: {
	tenant: string
	dateFrom: string
	dateTo: string
}) {
	const dashboard = await fetchSalesDashboardAction(tenant, dateFrom, dateTo)

	return (
		<>
			<div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
				<KpiCard
					title='売上'
					value={jpy.format(dashboard.summary.totalSales)}
					description={`Square ${jpy.format(dashboard.summary.squareSales)} / Invoice ${jpy.format(dashboard.summary.invoiceSales)}`}
					icon={<CircleDollarSignIcon className='h-4 w-4 text-teal-700' />}
				/>
				<KpiCard
					title='未入金'
					value={jpy.format(dashboard.summary.unpaidInvoiceAmount)}
					description={`${numberFormat.format(dashboard.summary.unpaidInvoiceCount)} 件`}
					icon={<BanknoteIcon className='h-4 w-4 text-amber-600' />}
				/>
				<KpiCard
					title='今月の新規顧客'
					value={`${numberFormat.format(dashboard.summary.newCustomersThisMonth)} 件`}
					description='初回Invoice作成ベース'
					icon={<UserPlusIcon className='h-4 w-4 text-blue-700' />}
				/>
				<KpiCard
					title='パイプライン案件'
					value={`${numberFormat.format(dashboard.pipelineRows.reduce((sum, row) => sum + row.dealCount, 0))} 件`}
					description={jpy.format(
						dashboard.pipelineRows.reduce((sum, row) => sum + row.amount, 0),
					)}
					icon={<ReceiptTextIcon className='h-4 w-4 text-violet-700' />}
				/>
			</div>

			<div className='grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]'>
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>月次売上</CardTitle>
					</CardHeader>
					<CardContent className='h-[340px]'>
						{dashboard.monthlySales.length === 0 ? (
							<EmptyState />
						) : (
							<MonthlySalesChart data={dashboard.monthlySales} />
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>パイプライン別案件金額</CardTitle>
					</CardHeader>
					<CardContent className='h-[340px]'>
						{dashboard.pipelineRows.length === 0 ? (
							<EmptyState />
						) : (
							<PipelineAmountChart data={dashboard.pipelineRows} />
						)}
					</CardContent>
				</Card>
			</div>

			<div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>
							パイプライン別案件数・金額
						</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>パイプライン</TableHead>
									<TableHead className='text-right'>件数</TableHead>
									<TableHead className='text-right'>金額</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{dashboard.pipelineRows.length === 0 ? (
									<EmptyTableRow colSpan={3} />
								) : (
									dashboard.pipelineRows.map(row => (
										<TableRow key={row.pipeline}>
											<TableCell className='font-medium'>
												{row.pipeline}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{numberFormat.format(row.dealCount)}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{jpy.format(row.amount)}
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
						<CardTitle className='text-base'>直近5件の取引</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>種別</TableHead>
									<TableHead>取引先/内容</TableHead>
									<TableHead className='text-right'>金額</TableHead>
									<TableHead>状態</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{dashboard.recentTransactions.length === 0 ? (
									<EmptyTableRow colSpan={4} />
								) : (
									dashboard.recentTransactions.map(row => (
										<TableRow key={`${row.source}-${row.id}`}>
											<TableCell>{row.source}</TableCell>
											<TableCell className='max-w-[220px] truncate'>
												{row.customerName || row.id}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{jpy.format(row.amount)}
											</TableCell>
											<TableCell>{row.status}</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</div>
		</>
	)
}

function SalesDashboardSkeleton() {
	return (
		<>
			<div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
				{Array.from({ length: 4 }).map((_, index) => (
					<Card key={index}>
						<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
							<Skeleton className='h-4 w-24' />
							<Skeleton className='h-4 w-4 rounded-full' />
						</CardHeader>
						<CardContent className='space-y-2'>
							<Skeleton className='h-8 w-28' />
							<Skeleton className='h-3 w-36' />
						</CardContent>
					</Card>
				))}
			</div>
			<div className='grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]'>
				<Skeleton className='h-[404px] w-full rounded-lg' />
				<Skeleton className='h-[404px] w-full rounded-lg' />
			</div>
			<div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
				<Skeleton className='h-72 w-full rounded-lg' />
				<Skeleton className='h-72 w-full rounded-lg' />
			</div>
		</>
	)
}

function PresetLink({
	tenant,
	modePrefix,
	preset,
	active,
	children,
}: {
	tenant: string
	modePrefix: string
	preset: Preset
	active: boolean
	children: React.ReactNode
}) {
	return (
		<Button asChild variant={active ? 'default' : 'outline'} size='sm'>
			<Link
				href={`${modePrefix}/${tenant}/dashboard?preset=${preset}` as Route}
				prefetch={false}
			>
				{children}
			</Link>
		</Button>
	)
}

function KpiCard({
	title,
	value,
	description,
	icon,
}: {
	title: string
	value: string
	description: string
	icon: React.ReactNode
}) {
	return (
		<Card>
			<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
				<CardTitle className='text-sm font-medium text-muted-foreground'>
					{title}
				</CardTitle>
				{icon}
			</CardHeader>
			<CardContent>
				<div className='text-2xl font-semibold tabular-nums'>{value}</div>
				<p className='mt-1 text-xs text-muted-foreground'>{description}</p>
			</CardContent>
		</Card>
	)
}

function EmptyState() {
	return (
		<div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
			集計データがありません
		</div>
	)
}

function EmptyTableRow({ colSpan }: { colSpan: number }) {
	return (
		<TableRow>
			<TableCell
				colSpan={colSpan}
				className='py-8 text-center text-muted-foreground'
			>
				集計データがありません
			</TableCell>
		</TableRow>
	)
}
