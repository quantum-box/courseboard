import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { ToastClient } from 'components/toast-client'
import { PageHeader } from 'components/ui/page-shell'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchOrdersAction, type OrderData } from './action'
import { DataFetchError } from './data-fetch-error'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const statusLabels: Record<string, string> = {
	Pending: '未確定',
	Confirmed: '確定',
	Shipped: '出荷済',
	Completed: '完了',
	Cancelled: 'キャンセル',
}

export default async function OrdersPage({
	params: { tenant },
	searchParams: { status = 'all' },
}: {
	params: { tenant: string }
	searchParams: { status?: string }
}) {
	const result = await fetchOrdersAction(tenant, status)
	const orders = result.data ?? []

	return (
		<V1Layout current='orders' tenant={tenant}>
			<MainLayout>
				<PageHeader
					title='受注'
					description='受注番号、取引先、チャネル別に注文を確認します'
					actions={
						<Button asChild>
							<Link href={`/${tenant}/orders/new` as Route}>新規作成</Link>
						</Button>
					}
				/>
				<section className='space-y-3'>
					<div className='flex flex-col gap-3 border-y bg-background/80 py-3 sm:flex-row sm:items-center sm:justify-between'>
						<h2 className='text-base font-semibold'>受注一覧</h2>
						<div className='flex flex-wrap gap-1.5'>
							{[
								'all',
								'Pending',
								'Confirmed',
								'Shipped',
								'Completed',
								'Cancelled',
							].map(value => (
								<Button
									key={value}
									variant={status === value ? 'default' : 'ghost'}
									size='sm'
									asChild
									className='h-8 px-3'
								>
									<Link href={`/${tenant}/orders?status=${value}` as Route}>
										{value === 'all' ? 'すべて' : statusLabels[value]}
									</Link>
								</Button>
							))}
						</div>
					</div>
					<div className='overflow-hidden rounded-md border bg-background'>
						{result.success ? (
							<OrderTable orders={orders} tenant={tenant} />
						) : (
							<DataFetchError
								title='受注一覧を取得できませんでした'
								message={result.message}
								retryHref={`/${tenant}/orders?status=${status}`}
							/>
						)}
					</div>
				</section>
				{result.success ? null : (
					<ToastClient
						title='受注一覧を取得できませんでした'
						description={
							result.message ??
							'外部APIまたは連携サービスが一時的に利用できません。再読み込みするか、少し待ってから再試行してください。'
						}
						variant='destructive'
					/>
				)}
			</MainLayout>
		</V1Layout>
	)
}

function OrderTable({
	orders,
	tenant,
}: { orders: OrderData[]; tenant: string }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>受注番号</TableHead>
					<TableHead>取引先</TableHead>
					<TableHead>チャネル</TableHead>
					<TableHead>ステータス</TableHead>
					<TableHead>作成日</TableHead>
					<TableHead className='text-right'>合計</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{orders.length === 0 ? (
					<TableRow>
						<TableCell colSpan={6} className='h-16 text-center'>
							受注はありません。
						</TableCell>
					</TableRow>
				) : null}
				{orders.map(order => (
					<TableRow key={order.id}>
						<TableCell>
							<Link
								className='font-medium hover:underline'
								href={`/${tenant}/orders/${order.id}` as Route}
							>
								{order.orderNumber}
							</Link>
							<div className='text-xs text-muted-foreground'>{order.id}</div>
						</TableCell>
						<TableCell>{order.clientName ?? order.clientId}</TableCell>
						<TableCell>{order.source}</TableCell>
						<TableCell>
							<Badge variant='outline'>
								{statusLabels[order.status] ?? order.status}
							</Badge>
						</TableCell>
						<TableCell>{order.createdAt.slice(0, 10)}</TableCell>
						<TableCell className='text-right'>
							{yen.format(order.totalAmount)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}
