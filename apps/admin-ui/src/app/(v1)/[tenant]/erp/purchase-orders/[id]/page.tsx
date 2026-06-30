import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { notFound } from 'next/navigation'
import {
	fetchPurchaseOrderAction,
	updatePurchaseOrderStatusAction,
} from '../actions'

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

export default async function PurchaseOrderDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	const result = await fetchPurchaseOrderAction(tenant, id)
	const order = result.data
	if (!order) notFound()
	const submit = updatePurchaseOrderStatusAction.bind(null, tenant, id)

	return (
		<V1Layout current='purchase-orders' tenant={tenant}>
			<MainLayout>
				<div className='flex items-start justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>
							{order.purchaseOrderNumber}
						</h1>
						<p className='text-sm text-muted-foreground'>
							{order.vendorName} / {order.id}
						</p>
					</div>
					<Badge variant='outline'>
						{statusLabels[order.status] ?? order.status}
					</Badge>
				</div>
				<div className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader>
							<CardTitle>明細</CardTitle>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>品目</TableHead>
										<TableHead className='text-right'>数量</TableHead>
										<TableHead className='text-right'>単価</TableHead>
										<TableHead className='text-right'>税額</TableHead>
										<TableHead className='text-right'>金額</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{order.items.map((item, index) => (
										<TableRow key={`${item.description}-${index}`}>
											<TableCell>{item.description}</TableCell>
											<TableCell className='text-right tabular-nums'>
												{item.quantity}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{yen.format(item.unitCost)}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{yen.format(item.taxAmount)}
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{yen.format(item.amount)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
					<div className='space-y-4'>
						<Card>
							<CardHeader>
								<CardTitle>状態</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<form action={submit} className='space-y-3'>
									<Select name='status' defaultValue={order.status}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='Draft'>下書き</SelectItem>
											<SelectItem value='Sent'>送付済</SelectItem>
											<SelectItem value='Received'>入荷済</SelectItem>
											<SelectItem value='Invoiced'>請求済</SelectItem>
										</SelectContent>
									</Select>
									<Button type='submit' className='w-full'>
										保存
									</Button>
								</form>
								<div className='space-y-1 text-sm text-muted-foreground'>
									<div>送付: {order.sentAt ?? '-'}</div>
									<div>入荷: {order.receivedAt ?? '-'}</div>
									<div>請求: {order.invoicedAt ?? '-'}</div>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>金額</CardTitle>
							</CardHeader>
							<CardContent className='space-y-2 text-sm'>
								<div className='flex justify-between'>
									<span>小計</span>
									<span className='tabular-nums'>
										{yen.format(order.subtotalAmount)}
									</span>
								</div>
								<div className='flex justify-between'>
									<span>税額</span>
									<span className='tabular-nums'>
										{yen.format(order.taxAmount)}
									</span>
								</div>
								<div className='flex justify-between border-t pt-2 font-semibold'>
									<span>合計</span>
									<span className='tabular-nums'>
										{yen.format(order.totalAmount)}
									</span>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>納品</CardTitle>
							</CardHeader>
							<CardContent className='space-y-2 text-sm'>
								<div>予定日: {order.expectedDeliveryDate ?? '-'}</div>
								<p className='text-muted-foreground'>
									在庫反映は未接続です。入荷済への変更は発注台帳上の状態管理として扱います。
								</p>
							</CardContent>
						</Card>
					</div>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
