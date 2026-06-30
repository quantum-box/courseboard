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
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import {
	listStockLevels,
	listStockMovements,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import { authWithCheck } from 'app/auth'
import { StockMovementAuditTable } from './_components/stock-movement-audit-table'

export default async function StockLevelAuditPage({
	params: { tenant, stock_level_id },
	searchParams,
}: {
	params: { tenant: string; stock_level_id: string }
	searchParams: {
		stock_item_id?: string
		sku?: string
		warehouse_id?: string
	}
}) {
	await authWithCheck()
	const prefix = getServerModePrefix(tenant)
	let stockError: string | null = null
	const stockLevels = await listStockLevels(tenant).catch(error => {
		console.error('Failed to load stock level audit summary:', error)
		stockError =
			error instanceof Error
				? error.message
				: '在庫データを取得できませんでした'
		return null
	})
	const stockLevel =
		stockLevels?.items.find(item => item.id === stock_level_id) ?? null
	const stockItemId = searchParams.stock_item_id ?? stockLevel?.stockItemId
	const sku = searchParams.sku ?? stockLevel?.skuCode
	const warehouseId = searchParams.warehouse_id ?? stockLevel?.warehouseId
	let movementsError: string | null = null
	const movements =
		stockItemId || sku || warehouseId
			? await listStockMovements(tenant, {
					stockItemId,
					sku,
					warehouseId,
					limit: 100,
				}).catch(error => {
					console.error('Failed to load stock movement audit:', error)
					movementsError =
						error instanceof Error
							? error.message
							: '在庫移動台帳を取得できませんでした'
					return null
				})
			: { items: [] }

	return (
		<V1Layout
			current='inventory'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/inventory` as Route}>
									在庫管理
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{sku ?? stock_level_id}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex flex-col gap-6'>
					{stockError && (
						<Card>
							<CardHeader>
								<CardTitle>在庫データを取得できませんでした</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4 text-sm text-muted-foreground'>
								<p>{stockError}</p>
								<Button variant='outline' size='sm' asChild>
									<Link
										href={
											`${prefix}/${tenant}/inventory/stock-levels/${stock_level_id}` as Route
										}
									>
										再試行
									</Link>
								</Button>
							</CardContent>
						</Card>
					)}
					<Card>
						<CardHeader>
							<CardTitle>StockLevel 監査</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<div>
									<p className='text-sm text-muted-foreground'>SKU</p>
									<p className='font-mono text-sm'>{sku ?? '-'}</p>
								</div>
								<div>
									<p className='text-sm text-muted-foreground'>倉庫</p>
									<p className='text-sm'>
										{stockLevel?.warehouseName ?? warehouseId ?? '-'}
									</p>
								</div>
								<div>
									<p className='text-sm text-muted-foreground'>手持在庫</p>
									<p className='font-mono text-sm tabular-nums'>
										{stockLevel?.quantityOnHand ?? '-'}
									</p>
								</div>
								<div>
									<p className='text-sm text-muted-foreground'>StockItem ID</p>
									<p className='font-mono text-xs'>{stockItemId ?? '-'}</p>
								</div>
							</div>
						</CardContent>
					</Card>
					{movementsError ? (
						<Card>
							<CardHeader>
								<CardTitle>在庫移動台帳を取得できませんでした</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4 text-sm text-muted-foreground'>
								<p>{movementsError}</p>
								<Button variant='outline' size='sm' asChild>
									<Link
										href={
											`${prefix}/${tenant}/inventory/stock-levels/${stock_level_id}` as Route
										}
									>
										再試行
									</Link>
								</Button>
							</CardContent>
						</Card>
					) : (
						<StockMovementAuditTable movements={movements?.items ?? []} />
					)}
				</div>
			</MainLayout>
		</V1Layout>
	)
}
