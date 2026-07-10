import Provider from 'app/(v1)/provider'
import { getUrqlProviderProps } from 'app/(v1)/urql-provider-props'
import { authWithCheck } from 'app/auth'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from 'components/ui/dropdown-menu'
import {
	Pagination,
	PaginationContent,
	PaginationItem,
} from 'components/ui/pagination'
import { Separator } from 'components/ui/separator'
import { formatDateOnly } from 'lib/date'
import { getGraphqlSdk } from 'lib/graphqlClient'
import {
	ChevronLeft,
	ChevronRight,
	Copy,
	CreditCard,
	MoreVertical,
	Truck,
} from 'lucide-react'
import { DeliveryNoteButton } from './delivery-note-button'

export const DetailOrderCard = async ({
	id,
	tenantId,
}: { id?: string; tenantId: string }) => {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenantId)
	let orders: Awaited<ReturnType<typeof sdk.detailOrderForSearch>>['orders'] =
		[]
	try {
		const result = await sdk.detailOrderForSearch()
		orders = result.orders
	} catch (error) {
		console.error('Failed to load order list', error)
		return (
			<Card>
				<CardHeader>
					<CardTitle>注文を取得できませんでした</CardTitle>
				</CardHeader>
				<CardContent>
					<p>
						注文情報の読み込みに失敗しました。連携設定を確認のうえ、しばらくしてから再度お試しください。
					</p>
				</CardContent>
			</Card>
		)
	}
	if (orders.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>注文が見つかりません</CardTitle>
				</CardHeader>
				<CardContent>
					<p>申し訳ありませんが、該当する注文情報が見つかりませんでした。</p>
				</CardContent>
			</Card>
		)
	}
	let order: Awaited<ReturnType<typeof sdk.detailOrder>>['order']
	try {
		const result = await sdk.detailOrder({ id: id ?? orders[0].id })
		order = result.order
	} catch (error) {
		console.error('Failed to load order detail', error)
		return (
			<Card>
				<CardHeader>
					<CardTitle>注文を取得できませんでした</CardTitle>
				</CardHeader>
				<CardContent>
					<p>
						注文詳細の読み込みに失敗しました。連携設定を確認のうえ、しばらくしてから再度お試しください。
					</p>
				</CardContent>
			</Card>
		)
	}
	return (
		<Card className='overflow-hidden'>
			<CardHeader className='flex flex-row items-start bg-muted/50'>
				<div className='grid gap-0.5'>
					<CardTitle className='group flex items-center gap-2 text-lg'>
						注文 {order.id.slice(-8)}
						<Button
							size='icon'
							variant='outline'
							className='h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100'
						>
							<Copy className='h-3 w-3' />
							<span className='sr-only'>注文IDをコピー</span>
						</Button>
					</CardTitle>
					<CardDescription>
						日付: {formatDateOnly(order.orderDate)}
					</CardDescription>
				</div>
				<div className='ml-auto flex items-center gap-1'>
					<Provider {...getUrqlProviderProps(tenantId, session.accessToken)}>
						<DeliveryNoteButton orderId={order.id} />
					</Provider>
					<Button size='sm' variant='outline' className='h-8 gap-1'>
						<Truck className='h-3.5 w-3.5' />
						<span className='lg:sr-only xl:not-sr-only xl:whitespace-nowrap'>
							注文を追跡
						</span>
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size='icon' variant='outline' className='h-8 w-8'>
								<MoreVertical className='h-3.5 w-3.5' />
								<span className='sr-only'>その他</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							<DropdownMenuItem>編集</DropdownMenuItem>
							<DropdownMenuItem>エクスポート</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem>削除</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</CardHeader>
			<CardContent className='p-6 text-sm'>
				<div className='grid gap-3'>
					<div className='font-semibold'>注文詳細</div>
					<ul className='grid gap-3'>
						{order.lineItems.map(item => (
							<li key={item.name} className='flex items-center justify-between'>
								<span className='text-muted-foreground'>
									{item.name} x <span>{item.quantity}</span>
								</span>
								<span>
									¥{(item.unitPrice * item.quantity).toLocaleString()}
								</span>
							</li>
						))}
					</ul>
					<Separator className='my-2' />
					<ul className='grid gap-3'>
						<li className='flex items-center justify-between'>
							<span className='text-muted-foreground'>小計</span>
							<span>¥{order.subtotal.toLocaleString()}</span>
						</li>
						<li className='flex items-center justify-between'>
							<span className='text-muted-foreground'>配送料</span>
							<span>¥500</span>
						</li>
						<li className='flex items-center justify-between'>
							<span className='text-muted-foreground'>税</span>
							<span>¥{order.tax.toLocaleString()}</span>
						</li>
						<li className='flex items-center justify-between font-semibold'>
							<span className='text-muted-foreground'>合計</span>
							<span>¥{order.total.toLocaleString()}</span>
						</li>
					</ul>
				</div>
				<Separator className='my-4' />
				<div className='grid grid-cols-2 gap-4'>
					<div className='grid gap-3'>
						<div className='font-semibold'>配送情報</div>
						<address className='grid gap-0.5 not-italic text-muted-foreground'>
							<span>山田太郎</span>
							<span>東京都渋谷区1-2-3</span>
							<span>渋谷マンション101</span>
						</address>
					</div>
					<div className='grid auto-rows-max gap-3'>
						<div className='font-semibold'>請求情報</div>
						<div className='text-muted-foreground'>配送先と同じ</div>
					</div>
				</div>
				<Separator className='my-4' />
				<div className='grid gap-3'>
					<div className='font-semibold'>顧客情報</div>
					<dl className='grid gap-3'>
						<div className='flex items-center justify-between'>
							<dt className='text-muted-foreground'>顧客名</dt>
							<dd>{order.client?.name ?? '—'}</dd>
						</div>
						<div className='flex items-center justify-between'>
							<dt className='text-muted-foreground'>メール</dt>
							<dd>
								{order.client?.email ? (
									<a href={`mailto:${order.client.email}`}>
										{order.client.email}
									</a>
								) : (
									'—'
								)}
							</dd>
						</div>
						<div className='flex items-center justify-between'>
							<dt className='text-muted-foreground'>電話番号</dt>
							<dd>
								<a href='tel:'>{order.client?.phoneNumber ?? '—'}</a>
							</dd>
						</div>
					</dl>
				</div>
				<Separator className='my-4' />
				<div className='grid gap-3'>
					<div className='font-semibold'>支払い情報</div>
					<dl className='grid gap-3'>
						<div className='flex items-center justify-between'>
							<dt className='flex items-center gap-1 text-muted-foreground'>
								<CreditCard className='h-4 w-4' />
								Visa
							</dt>
							<dd>**** **** **** 4532</dd>
						</div>
					</dl>
				</div>
			</CardContent>
			<CardFooter className='flex flex-row items-center border-t bg-muted/50 px-6 py-3'>
				<div className='text-xs text-muted-foreground'>
					更新日: <time dateTime='2023-11-23'>2023年11月23日</time>
				</div>
				<Pagination className='ml-auto mr-0 w-auto'>
					<PaginationContent>
						<PaginationItem>
							<Button size='icon' variant='outline' className='h-6 w-6'>
								<ChevronLeft className='h-3.5 w-3.5' />
								<span className='sr-only'>前の注文</span>
							</Button>
						</PaginationItem>
						<PaginationItem>
							<Button size='icon' variant='outline' className='h-6 w-6'>
								<ChevronRight className='h-3.5 w-3.5' />
								<span className='sr-only'>次の注文</span>
							</Button>
						</PaginationItem>
					</PaginationContent>
				</Pagination>
			</CardFooter>
		</Card>
	)
}
