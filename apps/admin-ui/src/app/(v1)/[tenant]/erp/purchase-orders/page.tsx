import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { PlusIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchPurchaseOrdersAction, type PurchaseOrderData } from './actions'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const statusLabels: Record<string, string> = {
	Draft: '下書き',
	Sent: '送付済',
	Received: '入荷済',
	Invoiced: '請求済',
}

export default async function PurchaseOrdersPage({
	params: { tenant },
	searchParams: { status = 'all' },
}: {
	params: { tenant: string }
	searchParams: { status?: string }
}) {
	const result = await fetchPurchaseOrdersAction(tenant, status)
	const orders = result.data ?? []

	return (
		<V1Layout current='purchase-orders' tenant={tenant}>
			<MainLayout>
				<div className='flex items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>発注書</h1>
						<p className='text-sm text-muted-foreground'>
							発注から入荷・請求までの状態を管理します。
						</p>
					</div>
					<Button asChild>
						<Link href={`/${tenant}/erp/purchase-orders/new` as Route}>
							<PlusIcon className='mr-2 h-4 w-4' />
							新規作成
						</Link>
					</Button>
				</div>
				<div className='flex flex-wrap gap-2'>
					{['all', 'Draft', 'Sent', 'Received', 'Invoiced'].map(value => (
						<Button
							key={value}
							variant={status === value ? 'default' : 'outline'}
							size='sm'
							asChild
						>
							<Link
								href={`/${tenant}/erp/purchase-orders?status=${value}` as Route}
							>
								{value === 'all' ? 'すべて' : statusLabels[value]}
							</Link>
						</Button>
					))}
				</div>
				<Card>
					<CardHeader>
						<CardTitle>発注書一覧</CardTitle>
					</CardHeader>
					<CardContent>
						<PurchaseOrderTable orders={orders} tenant={tenant} />
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}

function PurchaseOrderTable({
	orders,
	tenant,
}: {
	orders: PurchaseOrderData[]
	tenant: string
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>発注番号</TableHead>
					<TableHead>仕入先</TableHead>
					<TableHead>ステータス</TableHead>
					<TableHead>納品予定日</TableHead>
					<TableHead className='text-right'>合計</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{orders.length === 0 ? (
					<TableRow>
						<TableCell colSpan={5} className='h-24 text-center'>
							発注書はありません。
						</TableCell>
					</TableRow>
				) : null}
				{orders.map(order => (
					<TableRow key={order.id}>
						<TableCell>
							<Link
								className='font-medium hover:underline'
								href={`/${tenant}/erp/purchase-orders/${order.id}` as Route}
							>
								{order.purchaseOrderNumber}
							</Link>
							<div className='text-xs text-muted-foreground'>{order.id}</div>
						</TableCell>
						<TableCell>{order.vendorName}</TableCell>
						<TableCell>
							<Badge variant='outline'>
								{statusLabels[order.status] ?? order.status}
							</Badge>
						</TableCell>
						<TableCell>{order.expectedDeliveryDate ?? '-'}</TableCell>
						<TableCell className='text-right tabular-nums'>
							{yen.format(order.totalAmount)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}
