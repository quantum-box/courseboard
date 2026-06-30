import { Button } from 'components/ui/button'
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
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import {
	listLowStockAlerts,
	listStockLevels,
} from '../../procurement/_lib/erp-api'
import type { LowStockAlert } from '../../procurement/_lib/erp-api'
import {
	filterStockLevelsForOperator,
	getStockLevelOperatorState,
	normalizeStockLevelFilterState,
	type StockLevelFilterState,
} from './inventory-summary'
import { formatStockLevelDateTime } from './stock-level-format'

const stockLevelStateOptions: Array<{
	value: StockLevelFilterState
	label: string
}> = [
	{ value: 'all', label: '状態すべて' },
	{ value: 'attention', label: '要確認' },
	{ value: 'low_stock', label: '低在庫' },
	{ value: 'reorder_needed', label: '発注点割れ' },
	{ value: 'out_of_stock', label: '欠品' },
	{ value: 'allocated', label: '引当あり' },
	{ value: 'receiving_linked', label: '入荷反映あり' },
]

function getReorderAlertByStockLevel(
	alerts: LowStockAlert[],
): Map<string, LowStockAlert> {
	return new Map(alerts.map(alert => [alert.stockLevelId, alert]))
}

export async function StockLevelList({
	tenant,
	locationId,
	searchParams = {},
}: {
	tenant: string
	locationId?: string
	searchParams?: {
		q?: string
		warehouseId?: string
		state?: string
	}
}) {
	const prefix = getServerModePrefix(tenant)
	const filters = {
		query: searchParams.q,
		warehouseId: searchParams.warehouseId,
		state: normalizeStockLevelFilterState(searchParams.state),
	}
	let stockError: string | null = null
	const [stockLevelsResult, lowStockAlertsResult] = await Promise.allSettled([
		listStockLevels(tenant, locationId),
		listLowStockAlerts(tenant),
	])
	const result =
		stockLevelsResult.status === 'fulfilled' ? stockLevelsResult.value : null
	if (stockLevelsResult.status === 'rejected') {
		console.error('Failed to load stock levels:', stockLevelsResult.reason)
		stockError =
			stockLevelsResult.reason instanceof Error
				? stockLevelsResult.reason.message
				: '在庫データを取得できませんでした'
	}
	const lowStockAlerts =
		lowStockAlertsResult.status === 'fulfilled'
			? lowStockAlertsResult.value.items
			: []
	if (lowStockAlertsResult.status === 'rejected') {
		console.error(
			'Failed to load low stock alerts:',
			lowStockAlertsResult.reason,
		)
	}
	const lowStockStockLevelIds = new Set(
		lowStockAlerts.map(item => item.stockLevelId),
	)
	const reorderAlertByStockLevel = getReorderAlertByStockLevel(lowStockAlerts)

	if (!result) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>StockLevel 一覧</CardTitle>
					<CardDescription>
						検収確定後に更新された SKU x 倉庫単位の在庫残高です。
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
						<p className='font-medium text-foreground'>
							在庫データを取得できませんでした
						</p>
						<p className='mt-2'>
							{stockError ??
								'連携設定を確認のうえ、しばらくしてから再度お試しください。'}
						</p>
						<div className='mt-4 flex flex-wrap justify-center gap-2'>
							<Button variant='default' size='sm' asChild>
								<Link
									href={
										locationId
											? (`${prefix}/${tenant}/inventory/locations/${locationId}` as Route)
											: (`${prefix}/${tenant}/inventory` as Route)
									}
								>
									再試行
								</Link>
							</Button>
							<Button variant='outline' size='sm' asChild>
								<Link
									href={`${prefix}/${tenant}/procurement/deliveries` as Route}
								>
									納品書を確認する
								</Link>
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>
		)
	}

	const { items } = result
	const warehouseOptions = Array.from(
		items.reduce((map, item) => {
			if (item.warehouseId) {
				map.set(item.warehouseId, item.warehouseName || item.warehouseId)
			}
			return map
		}, new Map<string, string>()),
	)
		.map(([id, name]) => ({ id, name }))
		.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
	const filteredItems = filterStockLevelsForOperator(items, {
		...filters,
		lowStockStockLevelIds,
	})
	const filteredSummary = {
		totalAvailable: filteredItems.reduce(
			(sum, item) => sum + item.quantityAvailable,
			0,
		),
		totalAllocated: filteredItems.reduce(
			(sum, item) => sum + item.quantityAllocated,
			0,
		),
		attentionCount: filteredItems.filter(item => item.quantityAvailable < 0)
			.length,
		lowStockCount: filteredItems.filter(item =>
			lowStockStockLevelIds.has(item.id),
		).length,
	}
	const urgentLowStockAlerts = [...lowStockAlerts]
		.sort((a, b) => {
			if (b.shortageQuantity !== a.shortageQuantity) {
				return b.shortageQuantity - a.shortageQuantity
			}
			return a.skuCode.localeCompare(b.skuCode, 'ja')
		})
		.slice(0, 5)
	const hasActiveFilter =
		Boolean(filters.query?.trim()) ||
		Boolean(filters.warehouseId) ||
		filters.state !== 'all'

	return (
		<Card>
			<CardHeader className='flex flex-row items-start justify-between gap-3'>
				<div>
					<CardTitle>StockLevel 一覧</CardTitle>
					<CardDescription>
						検収確定後に更新された SKU x 倉庫単位の在庫残高です。
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				{items.length === 0 ? (
					<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
						在庫データはまだありません。
						<div className='mt-4'>
							<Button variant='outline' size='sm' asChild>
								<Link
									href={`${prefix}/${tenant}/procurement/deliveries` as Route}
								>
									納品書を確認する
								</Link>
							</Button>
						</div>
					</div>
				) : (
					<div className='space-y-4'>
						<form
							action={`${prefix}/${tenant}/inventory`}
							className='grid gap-3 rounded-lg border bg-muted/20 p-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto_auto]'
						>
							<input
								type='search'
								name='q'
								defaultValue={filters.query ?? ''}
								placeholder='SKU・商品名・倉庫で検索'
								className='h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
							/>
							<select
								name='warehouse_id'
								defaultValue={filters.warehouseId ?? ''}
								className='h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
							>
								<option value=''>倉庫すべて</option>
								{warehouseOptions.map(warehouse => (
									<option key={warehouse.id} value={warehouse.id}>
										{warehouse.name}
									</option>
								))}
							</select>
							<select
								name='state'
								defaultValue={filters.state}
								className='h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
							>
								{stockLevelStateOptions.map(option => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<Button type='submit' size='sm'>
								絞り込み
							</Button>
							<Button variant='outline' size='sm' asChild>
								<Link href={`${prefix}/${tenant}/inventory` as Route}>
									解除
								</Link>
							</Button>
						</form>
						<div className='grid gap-2 text-sm md:grid-cols-4'>
							<div className='rounded-md border px-3 py-2'>
								<div className='text-muted-foreground'>表示件数</div>
								<div className='text-lg font-semibold tabular-nums'>
									{filteredItems.length.toLocaleString('ja-JP')}
									<span className='ml-1 text-xs font-normal text-muted-foreground'>
										/ {items.length.toLocaleString('ja-JP')}
									</span>
								</div>
							</div>
							<div className='rounded-md border px-3 py-2'>
								<div className='text-muted-foreground'>表示中の利用可能</div>
								<div className='text-lg font-semibold tabular-nums'>
									{filteredSummary.totalAvailable.toLocaleString('ja-JP')}
								</div>
							</div>
							<div className='rounded-md border px-3 py-2'>
								<div className='text-muted-foreground'>表示中の引当</div>
								<div className='text-lg font-semibold tabular-nums'>
									{filteredSummary.totalAllocated.toLocaleString('ja-JP')}
								</div>
							</div>
							<div className='rounded-md border px-3 py-2'>
								<div className='text-muted-foreground'>低在庫 / 要確認</div>
								<div className='text-lg font-semibold tabular-nums'>
									{filteredSummary.lowStockCount.toLocaleString('ja-JP')} /{' '}
									{filteredSummary.attentionCount.toLocaleString('ja-JP')}
								</div>
							</div>
						</div>
						{lowStockAlertsResult.status === 'rejected' ? (
							<div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
								低在庫アラートを取得できなかったため、低在庫フィルタは一時的に空で表示しています。
							</div>
						) : null}
						{urgentLowStockAlerts.length > 0 ? (
							<div className='rounded-lg border border-amber-200 bg-amber-50/70 p-4'>
								<div className='flex flex-wrap items-start justify-between gap-3'>
									<div>
										<h3 className='text-sm font-semibold text-amber-950'>
											発注点割れ SKU
										</h3>
										<p className='mt-1 text-sm text-amber-900'>
											発注点を下回った SKU を不足量の大きい順に表示しています。
										</p>
									</div>
									<div className='flex flex-wrap gap-2'>
										<Button size='sm' asChild>
											<Link
												href={
													`${prefix}/${tenant}/inventory?state=reorder_needed` as Route
												}
											>
												一覧で絞り込み
											</Link>
										</Button>
										<Button variant='outline' size='sm' asChild>
											<Link
												href={
													`${prefix}/${tenant}/inventory/low-stock` as Route
												}
											>
												補充判断へ
											</Link>
										</Button>
									</div>
								</div>
								<div className='mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
									{urgentLowStockAlerts.map(alert => (
										<div
											key={alert.stockItemId}
											className='rounded-md border bg-background px-3 py-2 text-sm'
										>
											<div className='flex items-start justify-between gap-3'>
												<div>
													<div className='font-mono text-xs'>
														{alert.skuCode}
													</div>
													<div className='font-medium'>{alert.productName}</div>
													<div className='text-xs text-muted-foreground'>
														{alert.warehouseName}
													</div>
												</div>
												<Badge variant='secondary'>発注点割れ</Badge>
											</div>
											<div className='mt-2 grid grid-cols-3 gap-2 text-xs'>
												<div>
													<div className='text-muted-foreground'>現在庫</div>
													<div className='font-semibold tabular-nums'>
														{alert.quantityOnHand}
													</div>
												</div>
												<div>
													<div className='text-muted-foreground'>発注点</div>
													<div className='font-semibold tabular-nums'>
														{alert.reorderPointQuantity}
													</div>
												</div>
												<div>
													<div className='text-muted-foreground'>推奨補充</div>
													<div className='font-semibold tabular-nums'>
														{alert.recommendedOrderQuantity}
													</div>
												</div>
											</div>
										</div>
									))}
								</div>
							</div>
						) : null}
						{filteredItems.length === 0 ? (
							<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
								<p className='font-medium text-foreground'>
									条件に一致する在庫はありません
								</p>
								<p className='mt-2'>
									検索語、倉庫、状態を変更して確認してください。
								</p>
								{hasActiveFilter ? (
									<Button className='mt-4' variant='outline' size='sm' asChild>
										<Link href={`${prefix}/${tenant}/inventory` as Route}>
											条件を解除
										</Link>
									</Button>
								) : null}
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>状態</TableHead>
										<TableHead>SKU</TableHead>
										<TableHead>商品名</TableHead>
										<TableHead>倉庫</TableHead>
										<TableHead className='text-right'>手持在庫</TableHead>
										<TableHead className='text-right'>引当</TableHead>
										<TableHead className='text-right'>利用可能</TableHead>
										<TableHead className='hidden xl:table-cell text-right'>
											発注点
										</TableHead>
										<TableHead className='hidden xl:table-cell text-right'>
											推奨補充
										</TableHead>
										<TableHead className='hidden lg:table-cell'>
											最終更新
										</TableHead>
										<TableHead className='hidden xl:table-cell'>
											反映元
										</TableHead>
										<TableHead className='text-right'>監査</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredItems.map(item => {
										const isLowStock = lowStockStockLevelIds.has(item.id)
										const reorderAlert = reorderAlertByStockLevel.get(item.id)
										const state = getStockLevelOperatorState(item, isLowStock)
										return (
											<TableRow key={item.id}>
												<TableCell>
													<Badge variant={state.variant}>{state.label}</Badge>
												</TableCell>
												<TableCell className='font-mono text-xs'>
													{item.skuCode}
												</TableCell>
												<TableCell className='font-medium'>
													{item.productName}
												</TableCell>
												<TableCell>{item.warehouseName}</TableCell>
												<TableCell className='text-right tabular-nums'>
													{item.quantityOnHand}
												</TableCell>
												<TableCell className='text-right tabular-nums'>
													{item.quantityAllocated}
												</TableCell>
												<TableCell className='text-right tabular-nums'>
													{item.quantityAvailable}
													{item.quantityAvailable <= 0 || isLowStock ? (
														<Link
															href={
																`${prefix}/${tenant}/inventory/low-stock` as Route
															}
															className='mt-1 block text-xs text-blue-600 hover:underline'
														>
															補充判断へ
														</Link>
													) : null}
												</TableCell>
												<TableCell className='hidden xl:table-cell text-right tabular-nums'>
													{reorderAlert ? (
														reorderAlert.reorderPointQuantity
													) : (
														<span className='text-muted-foreground'>—</span>
													)}
												</TableCell>
												<TableCell className='hidden xl:table-cell text-right tabular-nums'>
													{reorderAlert ? (
														<div>
															<div className='font-medium'>
																{reorderAlert.recommendedOrderQuantity}
															</div>
															<div className='text-xs text-muted-foreground'>
																不足 {reorderAlert.shortageQuantity}
															</div>
														</div>
													) : (
														<span className='text-muted-foreground'>—</span>
													)}
												</TableCell>
												<TableCell className='hidden lg:table-cell text-sm text-muted-foreground'>
													{formatStockLevelDateTime(item.lastUpdatedAt)}
												</TableCell>
												<TableCell className='hidden xl:table-cell'>
													{item.sourceDeliveryId ? (
														<Link
															href={
																`${prefix}/${tenant}/procurement/deliveries/${item.sourceDeliveryId}` as Route
															}
															className='text-sm text-blue-600 hover:underline'
														>
															{item.sourceDeliveryId}
														</Link>
													) : (
														<span className='text-sm text-muted-foreground'>
															—
														</span>
													)}
												</TableCell>
												<TableCell className='text-right'>
													<Button variant='outline' size='sm' asChild>
														<Link
															href={
																`${prefix}/${tenant}/inventory/stock-levels/${item.id}?stock_item_id=${encodeURIComponent(item.stockItemId)}&sku=${encodeURIComponent(item.skuCode)}&warehouse_id=${encodeURIComponent(item.warehouseId ?? '')}` as Route
															}
														>
															履歴
														</Link>
													</Button>
												</TableCell>
											</TableRow>
										)
									})}
								</TableBody>
							</Table>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
