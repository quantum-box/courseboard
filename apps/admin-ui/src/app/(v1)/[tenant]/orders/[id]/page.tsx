import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Label } from 'components/ui/label'
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
import type { Route } from 'next'
import Link from 'next/link'
import {
	convertOrderToInvoiceAction,
	fetchOrderAction,
	shipOrderAction,
	updateOrderAction,
} from '../action'
import { summarizeOrderExceptionFlow } from '../order-exception-summary'

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

export default async function OrderDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	const result = await fetchOrderAction(tenant, id)
	const order = result.data
	if (!order) {
		return (
			<V1Layout current='orders' tenant={tenant}>
				<MainLayout>
					<Card>
						<CardHeader>
							<CardTitle>受注を取得できませんでした</CardTitle>
						</CardHeader>
						<CardContent className='space-y-3'>
							<p className='text-sm text-muted-foreground'>
								{result.message ??
									'外部APIまたは連携サービスが一時的に利用できません。少し待ってから再試行してください。'}
							</p>
							<div className='flex flex-wrap gap-2'>
								<Button asChild variant='outline'>
									<Link href={`/${tenant}/orders/${id}` as Route}>
										再読み込み
									</Link>
								</Button>
								<Button asChild variant='ghost'>
									<Link href={`/${tenant}/orders` as Route}>
										受注一覧に戻る
									</Link>
								</Button>
							</div>
						</CardContent>
					</Card>
				</MainLayout>
			</V1Layout>
		)
	}
	const update = updateOrderAction.bind(null, tenant, id)
	const ship = shipOrderAction.bind(null, tenant, id)
	const convert = convertOrderToInvoiceAction.bind(null, tenant, id)
	const exceptionSummary = summarizeOrderExceptionFlow(order)

	return (
		<V1Layout current='orders' tenant={tenant}>
			<MainLayout>
				<div className='flex items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>{order.orderNumber}</h1>
						<p className='text-sm text-muted-foreground'>
							{order.clientName ?? order.clientId}
						</p>
					</div>
					<Badge variant='outline'>
						{statusLabels[order.status] ?? order.status}
					</Badge>
				</div>
				<div className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader>
							<CardTitle>受注明細</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='grid gap-4'>
								<div className='grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4'>
									<div>
										<div className='text-muted-foreground'>チャネル</div>
										<div>{order.source}</div>
									</div>
									<div>
										<div className='text-muted-foreground'>Square Order</div>
										<div>{order.squareOrderId ?? '—'}</div>
									</div>
									<div>
										<div className='text-muted-foreground'>Square Payment</div>
										<div>{order.squarePaymentId ?? '—'}</div>
									</div>
									<div>
										<div className='text-muted-foreground'>在庫連携</div>
										<div>
											{order.inventoryDecrementedAt ? '反映済' : '未反映'}
										</div>
									</div>
								</div>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>SKU</TableHead>
											<TableHead>品目</TableHead>
											<TableHead className='text-right'>数量</TableHead>
											<TableHead className='text-right'>単価</TableHead>
											<TableHead className='text-right'>金額</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{order.items.map((item, index) => (
											<TableRow key={`${item.description}-${index}`}>
												<TableCell>{item.sku ?? '—'}</TableCell>
												<TableCell>{item.description}</TableCell>
												<TableCell className='text-right'>
													{item.quantity}
												</TableCell>
												<TableCell className='text-right'>
													{yen.format(item.unitPrice)}
												</TableCell>
												<TableCell className='text-right'>
													{yen.format(item.amount)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
								<div className='space-y-1 text-right'>
									<div>小計 {yen.format(order.subtotalAmount)}</div>
									<div>税 {yen.format(order.taxAmount)}</div>
									<div className='text-xl font-bold'>
										合計 {yen.format(order.totalAmount)}
									</div>
								</div>
								{order.notes ? (
									<p className='whitespace-pre-wrap text-sm'>{order.notes}</p>
								) : null}
							</div>
						</CardContent>
					</Card>
					<div className='space-y-4'>
						<Card>
							<CardHeader>
								<CardTitle>キャンセル・返品判断</CardTitle>
								<CardDescription>
									既存 API の状態から、operator が例外処理前に確認する項目です。
								</CardDescription>
							</CardHeader>
							<CardContent className='space-y-4 text-sm'>
								{exceptionSummary.requiresOperatorReview ? (
									<div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900'>
										返金、在庫戻し、請求書状態の確認が必要な可能性があります。
									</div>
								) : (
									<div className='rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900'>
										出荷前の通常キャンセルとして扱える状態です。
									</div>
								)}
								<div className='grid gap-3'>
									<div>
										<div className='flex items-center justify-between gap-2'>
											<span className='font-medium'>キャンセル</span>
											<Badge variant='outline'>
												{exceptionSummary.cancellationLabel}
											</Badge>
										</div>
										<p className='mt-1 text-muted-foreground'>
											{exceptionSummary.cancellationDetail}
										</p>
									</div>
									<div>
										<div className='flex items-center justify-between gap-2'>
											<span className='font-medium'>返品</span>
											<Badge variant='outline'>
												{exceptionSummary.returnLabel}
											</Badge>
										</div>
										<p className='mt-1 text-muted-foreground'>
											{exceptionSummary.returnDetail}
										</p>
									</div>
									<div>
										<div className='flex items-center justify-between gap-2'>
											<span className='font-medium'>返金</span>
											<Badge variant='outline'>
												{exceptionSummary.refundLabel}
											</Badge>
										</div>
										<p className='mt-1 text-muted-foreground'>
											{exceptionSummary.refundDetail}
										</p>
									</div>
									<div>
										<div className='flex items-center justify-between gap-2'>
											<span className='font-medium'>在庫影響</span>
											<Badge variant='outline'>
												{exceptionSummary.inventoryLabel}
											</Badge>
										</div>
										<p className='mt-1 text-muted-foreground'>
											{exceptionSummary.inventoryDetail}
										</p>
									</div>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>ステータス変更</CardTitle>
							</CardHeader>
							<CardContent>
								<form action={update} className='space-y-4'>
									<div>
										<Label>ステータス</Label>
										<Select name='status' defaultValue={order.status}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value='Pending'>未確定</SelectItem>
												<SelectItem value='Confirmed'>確定</SelectItem>
												<SelectItem value='Shipped'>出荷済</SelectItem>
												<SelectItem value='Completed'>完了</SelectItem>
												<SelectItem value='Cancelled'>キャンセル</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<label className='flex items-center gap-2 text-sm'>
										<input
											name='decrementInventory'
											type='checkbox'
											disabled={Boolean(order.inventoryDecrementedAt)}
										/>
										在庫を減算
									</label>
									<Button type='submit' className='w-full'>
										更新
									</Button>
								</form>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>出荷処理</CardTitle>
							</CardHeader>
							<CardContent>
								<form action={ship}>
									<Button
										type='submit'
										className='w-full'
										disabled={
											order.status === 'Shipped' || order.status === 'Completed'
										}
									>
										出荷済みにする
									</Button>
								</form>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>請求書化</CardTitle>
							</CardHeader>
							<CardContent>
								{order.convertedInvoiceId ? (
									<Button asChild className='w-full'>
										<Link
											href={
												`/${tenant}/invoices/${order.convertedInvoiceId}` as Route
											}
										>
											作成済み請求書を開く
										</Link>
									</Button>
								) : (
									<form action={convert}>
										<Button type='submit' className='w-full'>
											請求書へ変換
										</Button>
									</form>
								)}
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>キャンセル料請求</CardTitle>
							</CardHeader>
							<CardContent>
								<Button asChild className='w-full' variant='outline'>
									<Link
										href={
											`/${tenant}/cancellation-fees/new?orderId=${order.id}` as Route
										}
									>
										支払いURLを作成
									</Link>
								</Button>
							</CardContent>
						</Card>
					</div>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
