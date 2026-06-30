import { StockLevelList } from 'app/(v1)/[tenant]/inventory/_components/stock-level-list'
import { authWithCheck, isAdminRole } from 'app/auth'
import { Badge } from 'components/ui/badge'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from 'components/ui/breadcrumb'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { HelpPanel } from 'components/ui/help-panel'
import { Button } from 'components/ui/button'
import { PageHeader, PageToolbar } from 'components/ui/page-shell'
import { Skeleton } from 'components/ui/skeleton'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import {
	listInventoryLocations,
	listLowStockAlerts,
	listStockLevels,
} from '../procurement/_lib/erp-api'
import { summarizeInventoryForOperator } from './_components/inventory-summary'
import { ReplenishmentAgentPanel } from './_components/replenishment-agent-panel'
import { formatStockLevelDateTime } from './_components/stock-level-format'

export const metadata = {
	title: '在庫管理 | TACHYON Field',
	description: '在庫管理ページです。',
}

export default async function InventoryPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>
	searchParams: Promise<{
		q?: string
		warehouse_id?: string
		state?: string
	}>
}) {
	const { tenant } = await params
	const filters = await searchParams
	const prefix = getServerModePrefix(tenant)
	const session = await authWithCheck()
	const canRunReplenishmentAgent = isAdminRole(session.user.role)

	return (
		<V1Layout
			current='inventory'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>在庫管理</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='在庫管理'
					description='商品ごとの残高、引当、補充対象を確認します'
				/>
				<PageToolbar>
					<div className='flex flex-wrap gap-2'>
						<Button variant='outline' size='sm' asChild>
							<Link
								href={`${prefix}/${tenant}/inventory/stores` as Route}
								prefetch={false}
							>
								店舗マスタ
							</Link>
						</Button>
						<Button variant='outline' size='sm' asChild>
							<Link
								href={`${prefix}/${tenant}/inventory/locations` as Route}
								prefetch={false}
							>
								拠点別在庫
							</Link>
						</Button>
						<Button variant='outline' size='sm' asChild>
							<Link
								href={`${prefix}/${tenant}/inventory/transfers` as Route}
								prefetch={false}
							>
								在庫移動
							</Link>
						</Button>
						<Button variant='outline' size='sm' asChild>
							<Link
								href={`${prefix}/${tenant}/inventory/low-stock` as Route}
								prefetch={false}
							>
								低在庫アラート
							</Link>
						</Button>
					</div>
				</PageToolbar>
				<Suspense fallback={<InventorySummarySkeleton />}>
					<InventorySummarySection tenant={tenant} prefix={prefix} />
				</Suspense>
				<HelpPanel
					storageKey='inventory'
					title='StockLevel 一覧の見方'
					summary='検収確定後に増減した在庫残高を確認する SoR ビュー'
					sections={[
						{
							title: 'この画面で行うこと',
							content:
								'SKU x 倉庫単位の在庫残高を一覧で確認します。PLT-898 MVP では procurement の納品書検収結果がここに反映されます。',
						},
						{
							title: '各数量の意味',
							content:
								'・手持在庫: 実在庫の合計\n・引当: 既に利用予定として確保済みの数量\n・利用可能: 手持在庫から引当を差し引いた数量',
						},
						{
							title: '検収フローとの関係',
							content:
								'納品書詳細で「検収確定」を押すと在庫が増加し、この一覧の数値と最終更新時刻が更新されます。',
						},
					]}
				/>
				{canRunReplenishmentAgent ? (
					<ReplenishmentAgentPanel
						tenant={tenant}
						accessToken={session.accessToken}
					/>
				) : null}
				<Suspense
					fallback={
						<>
							<Skeleton className='h-[20px] rounded-full' />
							<Skeleton className='h-[20px] rounded-full' />
							<Skeleton className='h-[20px] rounded-full' />
						</>
					}
				>
					<StockLevelList
						tenant={tenant}
						searchParams={{
							q: filters.q,
							warehouseId: filters.warehouse_id,
							state: filters.state,
						}}
					/>
				</Suspense>
			</MainLayout>
		</V1Layout>
	)
}

async function InventorySummarySection({
	tenant,
	prefix,
}: {
	tenant: string
	prefix: string
}) {
	const [stockLevelsResult, lowStockAlertsResult, locationsResult] =
		await Promise.allSettled([
			listStockLevels(tenant),
			listLowStockAlerts(tenant),
			listInventoryLocations(tenant),
		])
	const summary = summarizeInventoryForOperator({
		stockLevels:
			stockLevelsResult.status === 'fulfilled'
				? stockLevelsResult.value.items
				: [],
		lowStockAlerts:
			lowStockAlertsResult.status === 'fulfilled'
				? lowStockAlertsResult.value.items
				: [],
		locations:
			locationsResult.status === 'fulfilled' ? locationsResult.value.items : [],
	})
	const hasSummaryError =
		stockLevelsResult.status === 'rejected' ||
		lowStockAlertsResult.status === 'rejected' ||
		locationsResult.status === 'rejected'

	return (
		<>
			<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
				<Card>
					<CardHeader className='pb-2'>
						<CardDescription>利用可能在庫</CardDescription>
						<CardTitle className='text-2xl tabular-nums'>
							{summary.totalAvailable.toLocaleString('ja-JP')}
						</CardTitle>
					</CardHeader>
					<CardContent className='text-sm text-muted-foreground'>
						手持 {summary.totalOnHand.toLocaleString('ja-JP')} / 引当{' '}
						{summary.totalAllocated.toLocaleString('ja-JP')}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardDescription>補充判断キュー</CardDescription>
						<CardTitle className='flex items-center gap-2 text-2xl tabular-nums'>
							{summary.lowStockAlertCount.toLocaleString('ja-JP')}
							{summary.pendingLowStockCount > 0 ? (
								<Badge variant='secondary'>
									未判断 {summary.pendingLowStockCount}
								</Badge>
							) : null}
						</CardTitle>
					</CardHeader>
					<CardContent className='flex items-center justify-between gap-3 text-sm text-muted-foreground'>
						<span>
							発注候補 {summary.purchaseCandidateCount.toLocaleString('ja-JP')}
						</span>
						<Button variant='outline' size='sm' asChild>
							<Link
								href={`${prefix}/${tenant}/inventory?state=low_stock` as Route}
								prefetch={false}
							>
								一覧で確認
							</Link>
						</Button>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardDescription>欠品・要確認</CardDescription>
						<CardTitle className='flex items-center gap-2 text-2xl tabular-nums'>
							{summary.outOfStockCount.toLocaleString('ja-JP')}
							{summary.negativeAvailableCount > 0 ? (
								<Badge variant='destructive'>
									負数 {summary.negativeAvailableCount}
								</Badge>
							) : null}
						</CardTitle>
					</CardHeader>
					<CardContent className='text-sm text-muted-foreground'>
						在庫一覧 {summary.stockLevelCount.toLocaleString('ja-JP')} 件
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardDescription>拠点</CardDescription>
						<CardTitle className='text-2xl tabular-nums'>
							{(summary.warehouseCount + summary.storeCount).toLocaleString(
								'ja-JP',
							)}
						</CardTitle>
					</CardHeader>
					<CardContent className='text-sm text-muted-foreground'>
						倉庫 {summary.warehouseCount} / 店舗 {summary.storeCount}
						<div>最終更新 {formatStockLevelDateTime(summary.lastUpdatedAt)}</div>
					</CardContent>
				</Card>
			</div>
			{hasSummaryError ? (
				<Card>
					<CardContent className='py-4 text-sm text-muted-foreground'>
						一部の在庫サマリを取得できませんでした。下の一覧または各詳細画面で再試行してください。
					</CardContent>
				</Card>
			) : null}
		</>
	)
}

function InventorySummarySkeleton() {
	return (
		<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
			{Array.from({ length: 4 }).map((_, index) => (
				<Card key={index}>
					<CardHeader className='space-y-2 pb-2'>
						<Skeleton className='h-4 w-24' />
						<Skeleton className='h-8 w-20' />
					</CardHeader>
					<CardContent>
						<Skeleton className='h-4 w-32' />
					</CardContent>
				</Card>
			))}
		</div>
	)
}
