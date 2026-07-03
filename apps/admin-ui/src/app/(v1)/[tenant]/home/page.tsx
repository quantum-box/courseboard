import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { PageHeader } from 'components/ui/page-shell'
import { Skeleton } from 'components/ui/skeleton'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import {
	AlertTriangle,
	BarChart3,
	Package,
	PackageCheck,
	ShoppingCart,
	TrendingUp,
	UserPlus,
} from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import {
	PERIODS,
	type PeriodKey,
	PeriodSwitcher,
	isPeriodKey,
} from './_components/period-switcher'
import { GaScopeOnboardingCard } from '../_components/ga-scope/ga-scope-onboarding-card'
import {
	type HomeDashboardMetric,
	fetchHomeDashboardAction,
} from '../dashboard/action'

export const metadata = {
	title: 'ダッシュボード',
	description: '管理ダッシュボード',
}

const jpy = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

function formatDashboardDate(date: Date) {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-')
}

function resolveDashboardRange(period: PeriodKey, now = new Date()) {
	const end = new Date(now)
	end.setHours(23, 59, 59, 999)
	const start = new Date(now)
	start.setHours(0, 0, 0, 0)

	if (period === '7d') {
		start.setDate(start.getDate() - 6)
	} else if (period === '30d') {
		start.setDate(start.getDate() - 29)
	} else if (period === 'month') {
		start.setDate(1)
	}

	return {
		dateFrom: formatDashboardDate(start),
		dateTo: formatDashboardDate(end),
	}
}

export default function HomePage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams?: { period?: string }
}) {
	const raw = searchParams?.period
	const period: PeriodKey = isPeriodKey(raw) ? raw : 'today'
	const periodLabel = PERIODS.find(p => p.key === period)?.label ?? ''
	const range = resolveDashboardRange(period)
	const modePrefix = getServerModePrefix(tenant)

	return (
		<V1Layout current='home' tenant={tenant}>
			<MainLayout>
				<div className='space-y-6'>
					<PageHeader
						title='ダッシュボード'
						description={`期間: ${periodLabel}（${range.dateFrom} - ${range.dateTo}）`}
						actions={<PeriodSwitcher tenant={tenant} current={period} />}
					/>

					<GaScopeOnboardingCard tenant={tenant} modePrefix={modePrefix} />

					<Suspense fallback={<HomeDashboardSkeleton />}>
						<HomeDashboard tenant={tenant} period={period} periodLabel={periodLabel} />
					</Suspense>

					<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
						<QuickActionCard
							title='注文管理'
							description='最近の注文を確認・処理'
							href={`/${tenant}/consumer-orders`}
							icon={<ShoppingCart className='h-5 w-5' />}
						/>
						<QuickActionCard
							title='商品管理'
							description='商品の追加・編集'
							href={`/${tenant}/library/products`}
							icon={<Package className='h-5 w-5' />}
						/>
						<QuickActionCard
							title='在庫管理'
							description='在庫状況の確認・調整'
							href={`/${tenant}/inventory`}
							icon={<BarChart3 className='h-5 w-5' />}
						/>
					</div>

					<Card>
						<CardHeader>
							<CardTitle className='text-base'>お知らせ</CardTitle>
						</CardHeader>
						<CardContent>
							<p className='text-sm text-muted-foreground'>
								API から取得できない KPI
								は値を表示せず、未取得として表示します。
							</p>
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

async function HomeDashboard({
	tenant,
	period,
	periodLabel,
}: {
	tenant: string
	period: PeriodKey
	periodLabel: string
}) {
	const dashboard = await fetchHomeDashboardAction(tenant, period)

	return (
		<>
			{dashboard.errors.length > 0 ? (
				<Card className='border-destructive/40'>
					<CardContent className='space-y-1 pt-6 text-sm text-destructive'>
						{dashboard.errors.map(error => (
							<p key={error}>{error}</p>
						))}
					</CardContent>
				</Card>
			) : null}

			<div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'>
				<KpiCard
					title='売上'
					value={formatCurrencyMetric(dashboard.metrics.salesJpy)}
					description={metricDescription(dashboard.metrics.salesJpy, periodLabel)}
					icon={<TrendingUp className='h-4 w-4 text-muted-foreground' />}
				/>
				<KpiCard
					title='注文数'
					value={formatCountMetric(dashboard.metrics.orderCount, '件')}
					description={metricDescription(dashboard.metrics.orderCount, periodLabel)}
					icon={<ShoppingCart className='h-4 w-4 text-muted-foreground' />}
				/>
				<KpiCard
					title='在庫アラート'
					value={formatCountMetric(dashboard.metrics.inventoryAlerts, '件')}
					description={metricDescription(
						dashboard.metrics.inventoryAlerts,
						'閾値を下回る商品',
					)}
					icon={<AlertTriangle className='h-4 w-4 text-amber-500' />}
				/>
				<KpiCard
					title='BOPIS受取待ち'
					value={formatCountMetric(dashboard.metrics.bopisPending, '件')}
					description={metricDescription(
						dashboard.metrics.bopisPending,
						'店舗受取の未引渡',
					)}
					icon={<PackageCheck className='h-4 w-4 text-muted-foreground' />}
				/>
				<KpiCard
					title='新規顧客数'
					value={formatCountMetric(dashboard.metrics.newCustomers, '名')}
					description={metricDescription(
						dashboard.metrics.newCustomers,
						periodLabel,
					)}
					icon={<UserPlus className='h-4 w-4 text-muted-foreground' />}
				/>
			</div>
		</>
	)
}

function HomeDashboardSkeleton() {
	return (
		<div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'>
			{Array.from({ length: 5 }).map((_, index) => (
				<Card key={index}>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<Skeleton className='h-4 w-20' />
						<Skeleton className='h-4 w-4 rounded-full' />
					</CardHeader>
					<CardContent className='space-y-2'>
						<Skeleton className='h-8 w-24' />
						<Skeleton className='h-3 w-28' />
					</CardContent>
				</Card>
			))}
		</div>
	)
}

function formatCurrencyMetric(metric: HomeDashboardMetric) {
	return metric.value === null ? '-' : jpy.format(metric.value)
}

function formatCountMetric(metric: HomeDashboardMetric, unit: string) {
	return metric.value === null
		? '-'
		: `${metric.value.toLocaleString('ja-JP')} ${unit}`
}

function metricDescription(metric: HomeDashboardMetric, readyText: string) {
	return metric.error ?? readyText
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
				<CardTitle className='text-sm font-medium'>{title}</CardTitle>
				{icon}
			</CardHeader>
			<CardContent>
				<div className='text-2xl font-bold'>{value}</div>
				<p className='text-xs text-muted-foreground'>{description}</p>
			</CardContent>
		</Card>
	)
}

function QuickActionCard({
	title,
	description,
	href,
	icon,
}: {
	title: string
	description: string
	href: string
	icon: React.ReactNode
}) {
	return (
		<Link href={href as never} prefetch={false}>
			<Card className='hover:bg-accent/50 transition-colors cursor-pointer'>
				<CardHeader className='flex flex-row items-center gap-3 pb-2'>
					<div className='rounded-md bg-primary/10 p-2 text-primary'>
						{icon}
					</div>
					<div>
						<CardTitle className='text-sm font-medium'>{title}</CardTitle>
						<p className='text-xs text-muted-foreground'>{description}</p>
					</div>
				</CardHeader>
			</Card>
		</Link>
	)
}
