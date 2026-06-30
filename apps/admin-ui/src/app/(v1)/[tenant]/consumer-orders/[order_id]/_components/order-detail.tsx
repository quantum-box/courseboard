'use client'

import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from 'components/ui/dialog'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { formatNanodollarAsUsd } from 'lib/format-price'
import {
	CheckIcon,
	HistoryIcon,
	PackageCheckIcon,
	RotateCcwIcon,
	TruckIcon,
	WrenchIcon,
	XIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { OrderStatusBadge } from '../../_components/order-status-badge'

type OrderData = {
	id: string
	tenantId?: string | null
	cartId?: string | null
	userId?: string | null
	sessionId?: string | null
	status: string
	paymentStatus?: string | null
	shippingName?: string | null
	shippingAddress?: string | null
	shippingPhone?: string | null
	customerEmail?: string | null
	customerId?: string | null
	customerName?: string | null
	salesChannel: string
	salesChannelDetail?: string | null
	sourceMedium?: string | null
	sourceCampaign?: string | null
	subtotalNanodollar: string
	shippingFeeNanodollar: string
	totalNanodollar: string
	items: {
		id: string
		productId: string
		productName: string
		quantity: number
		unitPriceNanodollar: string
		subtotalNanodollar: string
	}[]
	confirmedAt?: string | null
	shippedAt?: string | null
	deliveredAt?: string | null
	cancelledAt?: string | null
	refundedAt?: string | null
	createdAt: string
	updatedAt?: string
}

function formatSalesChannel(value?: string | null): string {
	switch (value) {
		case 'online_store':
		case 'online':
		case 'web':
			return 'オンライン'
		case 'physical_store':
		case 'store':
			return '店舗'
		case 'marketplace':
			return 'モール'
		case 'b2b':
			return 'B2B'
		case 'wholesale':
			return '卸'
		default:
			return value ?? '-'
	}
}

export function OrderDetail({
	order,
	tenant,
	onCancel,
	onConfirm,
	onPrepare,
	onShip,
	onDeliver,
	onRefund,
}: {
	order: OrderData
	tenant: string
	onCancel: () => Promise<void>
	onConfirm: () => Promise<void>
	onPrepare: () => Promise<void>
	onShip: () => Promise<void>
	onDeliver: () => Promise<void>
	onRefund: () => Promise<void>
}) {
	const router = useRouter()
	const [loading, setLoading] = useState(false)

	const handleCancel = async () => {
		setLoading(true)
		try {
			await onCancel()
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handleConfirm = async () => {
		setLoading(true)
		try {
			await onConfirm()
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handlePrepare = async () => {
		setLoading(true)
		try {
			await onPrepare()
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handleShip = async () => {
		setLoading(true)
		try {
			await onShip()
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handleDeliver = async () => {
		setLoading(true)
		try {
			await onDeliver()
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handleRefund = async () => {
		setLoading(true)
		try {
			await onRefund()
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const paymentStatus = order.paymentStatus ?? 'unpaid'
	const canRefund = paymentStatus === 'paid'
	const isRefunded = paymentStatus === 'refunded'

	return (
		<div className='flex flex-col gap-4 sm:gap-6'>
			{/* Order header */}
			<Card>
				<CardHeader>
					<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							<CardTitle className='text-base sm:text-lg'>
								注文 {order.id.slice(0, 12)}...
							</CardTitle>
							<p className='text-sm text-muted-foreground'>
								作成日: {new Date(order.createdAt).toLocaleString('ja-JP')}
							</p>
						</div>
						<div className='flex flex-wrap items-center gap-2 sm:gap-3'>
							<OrderStatusBadge status={order.status} />
							{isRefunded && (
								<span className='inline-flex items-center rounded-md bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800'>
									返金済み
								</span>
							)}
							{canRefund && (
								<Dialog>
									<DialogTrigger asChild>
										<Button size='sm' variant='outline' disabled={loading}>
											<RotateCcwIcon className='mr-1 h-4 w-4' />
											返金
										</Button>
									</DialogTrigger>
									<DialogContent>
										<DialogHeader>
											<DialogTitle>この注文を全額返金しますか？</DialogTitle>
											<DialogDescription>
												決済を取り消し、全額を顧客に返金します。この操作は取り消せません。
											</DialogDescription>
										</DialogHeader>
										<DialogFooter>
											<DialogClose asChild>
												<Button variant='outline'>戻る</Button>
											</DialogClose>
											<DialogClose asChild>
												<Button
													variant='destructive'
													onClick={handleRefund}
													disabled={loading}
												>
													返金する
												</Button>
											</DialogClose>
										</DialogFooter>
									</DialogContent>
								</Dialog>
							)}
							{order.status === 'pending' && (
								<>
									<Button size='sm' onClick={handleConfirm} disabled={loading}>
										<CheckIcon className='mr-1 h-4 w-4' />
										確認
									</Button>
									<Dialog>
										<DialogTrigger asChild>
											<Button size='sm' variant='destructive'>
												<XIcon className='mr-1 h-4 w-4' />
												キャンセル
											</Button>
										</DialogTrigger>
										<DialogContent>
											<DialogHeader>
												<DialogTitle>注文をキャンセルしますか？</DialogTitle>
												<DialogDescription>
													この操作は取り消せません。注文をキャンセルしてもよろしいですか？
												</DialogDescription>
											</DialogHeader>
											<DialogFooter>
												<DialogClose asChild>
													<Button variant='outline'>戻る</Button>
												</DialogClose>
												<DialogClose asChild>
													<Button
														variant='destructive'
														onClick={handleCancel}
														disabled={loading}
													>
														キャンセルする
													</Button>
												</DialogClose>
											</DialogFooter>
										</DialogContent>
									</Dialog>
								</>
							)}
							{order.status === 'confirmed' && (
								<>
									<Button size='sm' onClick={handlePrepare} disabled={loading}>
										<WrenchIcon className='mr-1 h-4 w-4' />
										準備開始
									</Button>
									<Button size='sm' onClick={handleShip} disabled={loading}>
										<TruckIcon className='mr-1 h-4 w-4' />
										出荷
									</Button>
									<Dialog>
										<DialogTrigger asChild>
											<Button size='sm' variant='destructive'>
												<XIcon className='mr-1 h-4 w-4' />
												キャンセル
											</Button>
										</DialogTrigger>
										<DialogContent>
											<DialogHeader>
												<DialogTitle>注文をキャンセルしますか？</DialogTitle>
												<DialogDescription>
													この操作は取り消せません。注文をキャンセルしてもよろしいですか？
												</DialogDescription>
											</DialogHeader>
											<DialogFooter>
												<DialogClose asChild>
													<Button variant='outline'>戻る</Button>
												</DialogClose>
												<DialogClose asChild>
													<Button
														variant='destructive'
														onClick={handleCancel}
														disabled={loading}
													>
														キャンセルする
													</Button>
												</DialogClose>
											</DialogFooter>
										</DialogContent>
									</Dialog>
								</>
							)}
							{order.status === 'preparing' && (
								<>
									<Button size='sm' onClick={handleShip} disabled={loading}>
										<TruckIcon className='mr-1 h-4 w-4' />
										出荷
									</Button>
									<Dialog>
										<DialogTrigger asChild>
											<Button size='sm' variant='destructive'>
												<XIcon className='mr-1 h-4 w-4' />
												キャンセル
											</Button>
										</DialogTrigger>
										<DialogContent>
											<DialogHeader>
												<DialogTitle>注文をキャンセルしますか？</DialogTitle>
												<DialogDescription>
													この操作は取り消せません。注文をキャンセルしてもよろしいですか？
												</DialogDescription>
											</DialogHeader>
											<DialogFooter>
												<DialogClose asChild>
													<Button variant='outline'>戻る</Button>
												</DialogClose>
												<DialogClose asChild>
													<Button
														variant='destructive'
														onClick={handleCancel}
														disabled={loading}
													>
														キャンセルする
													</Button>
												</DialogClose>
											</DialogFooter>
										</DialogContent>
									</Dialog>
								</>
							)}
							{order.status === 'shipped' && (
								<Button size='sm' onClick={handleDeliver} disabled={loading}>
									<PackageCheckIcon className='mr-1 h-4 w-4' />
									配達完了
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
			</Card>

			{/* Shipping info */}
			<div className='grid grid-cols-1 gap-6 sm:grid-cols-2'>
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>顧客・配送先情報</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
							<dt className='text-muted-foreground'>顧客名</dt>
							<dd>{order.customerName ?? order.shippingName ?? '-'}</dd>
							<dt className='text-muted-foreground'>顧客ID</dt>
							<dd className='flex min-w-0 flex-wrap items-center gap-2'>
								<span className='break-all font-mono text-xs'>
									{order.customerId ?? '-'}
								</span>
								{order.customerId ? (
									<Button asChild variant='outline' size='sm' className='h-7'>
										<Link
											href={`/${tenant}/audit-logs?resourceType=customer&resourceId=${encodeURIComponent(order.customerId)}`}
										>
											<HistoryIcon className='mr-1 h-3.5 w-3.5' />
											履歴
										</Link>
									</Button>
								) : null}
							</dd>
							<dt className='text-muted-foreground'>メール</dt>
							<dd>{order.customerEmail ?? '-'}</dd>
							<dt className='text-muted-foreground'>氏名</dt>
							<dd>{order.shippingName ?? '-'}</dd>
							<dt className='text-muted-foreground'>住所</dt>
							<dd>{order.shippingAddress ?? '-'}</dd>
							<dt className='text-muted-foreground'>電話番号</dt>
							<dd>{order.shippingPhone ?? '-'}</dd>
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className='text-base'>注文情報</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
							<dt className='text-muted-foreground'>ユーザーID</dt>
							<dd className='font-mono text-xs'>
								{order.userId ?? order.sessionId ?? '-'}
							</dd>
							<dt className='text-muted-foreground'>カートID</dt>
							<dd className='font-mono text-xs'>{order.cartId ?? '-'}</dd>
							<dt className='text-muted-foreground'>販売チャネル</dt>
							<dd>{formatSalesChannel(order.salesChannel)}</dd>
							<dt className='text-muted-foreground'>チャネル詳細</dt>
							<dd>{order.salesChannelDetail ?? '-'}</dd>
							<dt className='text-muted-foreground'>流入元</dt>
							<dd>
								{[order.sourceMedium, order.sourceCampaign]
									.filter(Boolean)
									.join(' / ') || '-'}
							</dd>
							{order.confirmedAt && (
								<>
									<dt className='text-muted-foreground'>確認日時</dt>
									<dd>{new Date(order.confirmedAt).toLocaleString('ja-JP')}</dd>
								</>
							)}
							{order.shippedAt && (
								<>
									<dt className='text-muted-foreground'>出荷日時</dt>
									<dd>{new Date(order.shippedAt).toLocaleString('ja-JP')}</dd>
								</>
							)}
							{order.deliveredAt && (
								<>
									<dt className='text-muted-foreground'>配達日時</dt>
									<dd>{new Date(order.deliveredAt).toLocaleString('ja-JP')}</dd>
								</>
							)}
							{order.cancelledAt && (
								<>
									<dt className='text-muted-foreground'>キャンセル日時</dt>
									<dd>{new Date(order.cancelledAt).toLocaleString('ja-JP')}</dd>
								</>
							)}
							{order.refundedAt && (
								<>
									<dt className='text-muted-foreground'>返金日時</dt>
									<dd>{new Date(order.refundedAt).toLocaleString('ja-JP')}</dd>
								</>
							)}
							<dt className='text-muted-foreground'>支払ステータス</dt>
							<dd>{paymentStatus}</dd>
						</dl>
					</CardContent>
				</Card>
			</div>

			{/* Order items */}
			<Card>
				<CardHeader>
					<CardTitle className='text-base'>注文明細</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>商品名</TableHead>
								<TableHead className='text-right'>数量</TableHead>
								<TableHead className='hidden sm:table-cell text-right'>
									単価
								</TableHead>
								<TableHead className='text-right'>小計</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{order.items.map(item => (
								<TableRow key={item.id}>
									<TableCell>{item.productName}</TableCell>
									<TableCell className='text-right'>{item.quantity}</TableCell>
									<TableCell className='hidden sm:table-cell text-right font-mono'>
										{formatNanodollarAsUsd(item.unitPriceNanodollar)}
									</TableCell>
									<TableCell className='text-right font-mono'>
										{formatNanodollarAsUsd(item.subtotalNanodollar)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>

					<div className='mt-4 flex flex-col items-end gap-1 border-t pt-4'>
						<div className='flex gap-8 text-sm'>
							<span className='text-muted-foreground'>小計</span>
							<span className='font-mono'>
								{formatNanodollarAsUsd(order.subtotalNanodollar)}
							</span>
						</div>
						<div className='flex gap-8 text-sm'>
							<span className='text-muted-foreground'>送料</span>
							<span className='font-mono'>
								{formatNanodollarAsUsd(order.shippingFeeNanodollar)}
							</span>
						</div>
						<div className='flex gap-8 text-base font-bold'>
							<span>合計</span>
							<span className='font-mono'>
								{formatNanodollarAsUsd(order.totalNanodollar)}
							</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
