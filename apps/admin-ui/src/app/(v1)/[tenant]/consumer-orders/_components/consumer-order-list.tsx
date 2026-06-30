import { authWithCheck } from 'app/auth'
import { ToastClient } from 'components/toast-client'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import {
	ConsumerOrderDataTable,
	type ConsumerOrderTableRow,
} from './consumer-order-data-table'
import { ConsumerOrderFetchError } from './consumer-order-fetch-error'

export async function ConsumerOrderList({
	searchParams: { page, status },
	tenant,
}: {
	searchParams: { page?: string; status?: string }
	tenant: string
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	const mp = getServerModePrefix(tenant)
	const pageParam = Number(page ?? '1')
	const currentPage =
		Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1
	const pageSize = 20
	const offset = (currentPage - 1) * pageSize

	let orders: Awaited<
		ReturnType<typeof sdk.getConsumerOrdersForAdmin>
	>['consumerOrders']['items'] = []
	let loadError: string | undefined
	try {
		const { consumerOrders } = await sdk.getConsumerOrdersForAdmin({
			limit: pageSize,
			offset,
		})
		orders = consumerOrders?.items ?? []
	} catch (error) {
		console.error('Failed to load consumer orders', error)
		loadError =
			'注文データの取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
	}

	const filteredOrders =
		status && status !== 'all'
			? orders.filter(o => o.status === status)
			: orders

	const hasMore = orders.length >= pageSize
	const prevPage = currentPage > 1 ? currentPage - 1 : null
	const nextPage = hasMore ? currentPage + 1 : null

	const buildPageUrl = (targetPage: number, tab?: string) => {
		const params = new URLSearchParams()
		if (targetPage > 1) params.set('page', String(targetPage))
		if (tab && tab !== 'all') params.set('status', tab)
		const search = params.toString()
		return `${mp}/${tenant}/consumer-orders${search ? `?${search}` : ''}` as Route
	}
	const toRows = (items: typeof filteredOrders): ConsumerOrderTableRow[] =>
		items.map(order => ({
			createdAt: order.createdAt,
			customerEmail: order.customerEmail,
			customerId: order.customerId,
			customerName: order.customerName,
			fulfillmentMethod: order.fulfillmentMethod,
			id: order.id,
			itemCount: order.items.length,
			pickupDeadline: order.pickupDeadline,
			salesChannel: order.salesChannel,
			salesChannelDetail: order.salesChannelDetail,
			sessionId: order.sessionId,
			shippingName: order.shippingName,
			status: order.status,
			totalNanodollar: order.totalNanodollar,
			userId: order.userId,
		}))

	const renderTable = (items: typeof filteredOrders) => (
		<Card>
			<CardContent className='pt-6'>
				<ConsumerOrderDataTable
					currentPage={currentPage}
					hasNextPage={hasMore}
					nextHref={nextPage ? buildPageUrl(nextPage, status) : undefined}
					orderBaseHref={`${mp}/${tenant}/consumer-orders`}
					previousHref={prevPage ? buildPageUrl(prevPage, status) : undefined}
					rows={toRows(items)}
				/>
			</CardContent>
		</Card>
	)

	return (
		<div className='flex flex-col gap-4'>
			<Card>
				<CardHeader>
					<CardTitle>受注管理</CardTitle>
					<CardDescription>
						EC ストアフロント経由の注文を管理します。
					</CardDescription>
				</CardHeader>
			</Card>

			{loadError ? (
				<>
					<ConsumerOrderFetchError
						message={loadError}
						retryHref={buildPageUrl(currentPage, status)}
					/>
					<ToastClient
						title='注文データを取得できませんでした'
						description={loadError}
						variant='destructive'
					/>
				</>
			) : (
				<Tabs defaultValue={status ?? 'all'}>
					<TabsList className='w-full sm:w-auto'>
						<TabsTrigger value='all'>
							<Link href={buildPageUrl(1, 'all')}>すべて</Link>
						</TabsTrigger>
						<TabsTrigger value='pending'>
							<Link href={buildPageUrl(1, 'pending')}>保留中</Link>
						</TabsTrigger>
						<TabsTrigger value='confirmed'>
							<Link href={buildPageUrl(1, 'confirmed')}>確認済み</Link>
						</TabsTrigger>
						<TabsTrigger value='preparing'>
							<Link href={buildPageUrl(1, 'preparing')}>準備中</Link>
						</TabsTrigger>
						<TabsTrigger value='cancelled'>
							<Link href={buildPageUrl(1, 'cancelled')}>キャンセル</Link>
						</TabsTrigger>
					</TabsList>

					<TabsContent value='all'>{renderTable(orders)}</TabsContent>
					<TabsContent value='pending'>
						{renderTable(orders.filter(o => o.status === 'pending'))}
					</TabsContent>
					<TabsContent value='confirmed'>
						{renderTable(orders.filter(o => o.status === 'confirmed'))}
					</TabsContent>
					<TabsContent value='preparing'>
						{renderTable(orders.filter(o => o.status === 'preparing'))}
					</TabsContent>
					<TabsContent value='cancelled'>
						{renderTable(orders.filter(o => o.status === 'cancelled'))}
					</TabsContent>
				</Tabs>
			)}
		</div>
	)
}
