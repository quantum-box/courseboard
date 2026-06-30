import { updateLowStockDecisionAction } from 'app/(v1)/[tenant]/inventory/actions'
import { listLowStockAlerts } from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Input } from 'components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = {
	title: '低在庫アラート | TACHYON Field',
	description: '低在庫アラートと補充判断ワークフローです。',
}

function statusLabel(status: string): string {
	switch (status) {
		case 'on_hold':
			return '保留'
		case 'purchase_candidate':
			return '発注候補'
		default:
			return '未判断'
	}
}

function statusVariant(status: string): 'default' | 'outline' | 'secondary' {
	switch (status) {
		case 'purchase_candidate':
			return 'default'
		case 'on_hold':
			return 'secondary'
		default:
			return 'outline'
	}
}

export default async function LowStockPage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)
	let alertsError: string | null = null
	const result = await listLowStockAlerts(tenant).catch(error => {
		console.error('Failed to load low stock alerts:', error)
		alertsError =
			error instanceof Error
				? error.message
				: '低在庫アラートを取得できませんでした'
		return null
	})
	const items = result?.items ?? []

	return (
		<V1Layout
			current='inventory'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink href={`${prefix}/${tenant}/inventory` as Route}>
								在庫管理
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>低在庫アラート</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h1 className='text-xl font-semibold'>低在庫アラート</h1>
						<p className='text-sm text-muted-foreground'>
							SKU x 倉庫単位で発注点を下回った在庫を確認します。
						</p>
					</div>
					<Button variant='outline' size='sm' asChild>
						<Link href={`${prefix}/${tenant}/inventory` as Route}>
							在庫一覧
						</Link>
					</Button>
				</div>

				<Card>
					<CardHeader className='flex flex-row items-start justify-between gap-3'>
						<div>
							<CardTitle>補充判断キュー</CardTitle>
							<CardDescription>
								推奨数量を確認し、保留または発注候補に振り分けます。
							</CardDescription>
						</div>
					</CardHeader>
					<CardContent>
						{!result ? (
							<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
								<p className='font-medium text-foreground'>
									低在庫アラートを取得できませんでした
								</p>
								<p className='mt-2'>
									{alertsError ??
										'連携設定を確認のうえ、しばらくしてから再度お試しください。'}
								</p>
								<div className='mt-4'>
									<Button variant='outline' size='sm' asChild>
										<Link
											href={`${prefix}/${tenant}/inventory/low-stock` as Route}
										>
											再試行
										</Link>
									</Button>
								</div>
							</div>
						) : items.length === 0 ? (
							<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
								低在庫アラートはありません。
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>SKU</TableHead>
										<TableHead>倉庫</TableHead>
										<TableHead className='text-right'>現在庫</TableHead>
										<TableHead className='text-right'>安全在庫</TableHead>
										<TableHead className='text-right'>発注点</TableHead>
										<TableHead className='text-right'>推奨補充</TableHead>
										<TableHead>状態</TableHead>
										<TableHead className='min-w-[280px]'>判断</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{items.map(item => (
										<TableRow key={item.stockItemId}>
											<TableCell>
												<div className='font-mono text-xs'>{item.skuCode}</div>
												<div className='text-xs text-muted-foreground'>
													{item.productName}
												</div>
											</TableCell>
											<TableCell>{item.warehouseName}</TableCell>
											<TableCell className='text-right tabular-nums'>
												{item.quantityOnHand}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{item.safetyStockQuantity}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{item.reorderPointQuantity}
											</TableCell>
											<TableCell className='text-right tabular-nums font-medium'>
												{item.recommendedOrderQuantity}
											</TableCell>
											<TableCell>
												<Badge variant={statusVariant(item.decisionStatus)}>
													{statusLabel(item.decisionStatus)}
												</Badge>
											</TableCell>
											<TableCell>
												<form
													action={updateLowStockDecisionAction.bind(
														null,
														tenant,
													)}
													className='flex flex-wrap items-center justify-end gap-2'
												>
													<input
														type='hidden'
														name='stockItemId'
														value={item.stockItemId}
													/>
													<Input
														name='note'
														placeholder='メモ'
														defaultValue={item.decisionNote ?? ''}
														className='h-8 w-32'
													/>
													<Button
														type='submit'
														name='status'
														value='on_hold'
														variant='outline'
														size='sm'
													>
														保留
													</Button>
													<Button
														type='submit'
														name='status'
														value='purchase_candidate'
														size='sm'
													>
														発注候補
													</Button>
												</form>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}
