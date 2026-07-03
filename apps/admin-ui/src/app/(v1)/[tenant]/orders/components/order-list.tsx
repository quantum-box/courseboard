import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from 'components/ui/dropdown-menu'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import { formatDate } from 'lib/date'
import { getSdkWithAuth } from 'lib/graphqlClientWithAuth'
import { File, ListFilter } from 'lucide-react'

export const OrderList = async ({
	tenant_id,
}: {
	tenant_id: string
}) => {
	const sdk = await getSdkWithAuth(tenant_id)
	let orders: Awaited<ReturnType<typeof sdk.recentOrder>>['orders'] = []
	let loadError: string | null = null
	try {
		const result = await sdk.recentOrder()
		orders = result.orders
	} catch (error) {
		console.error('Failed to load recent orders', error)
		loadError =
			'注文の読み込みに失敗しました。連携設定を確認のうえ、しばらくしてから再度お試しください。'
	}

	return (
		<Tabs defaultValue='week'>
			<div className='flex items-center'>
				<TabsList>
					<TabsTrigger value='week'>週</TabsTrigger>
					<TabsTrigger value='month'>月</TabsTrigger>
					<TabsTrigger value='year'>年</TabsTrigger>
				</TabsList>
				<div className='ml-auto flex items-center gap-2'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant='outline' size='sm' className='h-7 gap-1 text-sm'>
								<ListFilter className='h-3.5 w-3.5' />
								<span className='sr-only sm:not-sr-only'>フィルター</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							<DropdownMenuLabel>フィルター</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem checked>完了</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem>却下</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem>返金済み</DropdownMenuCheckboxItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button size='sm' variant='outline' className='h-7 gap-1 text-sm'>
						<File className='h-3.5 w-3.5' />
						<span className='sr-only sm:not-sr-only'>エクスポート</span>
					</Button>
				</div>
			</div>
			<TabsContent value='week'>
				<Card>
					<CardHeader className='px-7'>
						<CardTitle>注文</CardTitle>
						<CardDescription>あなたのストアからの最近の注文</CardDescription>
					</CardHeader>
					<CardContent>
						{loadError ? (
							<div className='py-8 text-center text-sm text-muted-foreground'>
								{loadError}
							</div>
						) : orders.length === 0 ? (
							<div className='py-8 text-center text-sm text-muted-foreground'>
								表示できる注文がまだありません。
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>注文</TableHead>
										<TableHead>顧客</TableHead>
										<TableHead className='hidden sm:table-cell'>
											見積ID
										</TableHead>
										<TableHead className='hidden md:table-cell'>日付</TableHead>
										<TableHead className='text-right'>合計</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{orders.map(order => (
										<TableRow key={order.id}>
											<TableCell>{order.id}</TableCell>
											<TableCell>
												<div>{order.client?.name ?? '—'}</div>
												<div
													className='text-[10px] text-muted-foreground overflow-hidden text-ellipsis'
													style={{ maxWidth: '100px' }}
												>
													{order.clientId}
												</div>
											</TableCell>
											<TableCell className='hidden sm:table-cell'>
												<div>{order.quote?.title ?? '—'}</div>
												<div
													className='text-[10px] text-muted-foreground overflow-hidden text-ellipsis'
													style={{ maxWidth: '100px' }}
												>
													{order.quotesId}
												</div>
											</TableCell>
											<TableCell className='hidden md:table-cell'>
												{formatDate(order.orderDate)}
											</TableCell>
											<TableCell className='text-right'>
												{order.total.toLocaleString('ja-JP', {
													style: 'currency',
													currency: order.currency,
												})}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	)
}
