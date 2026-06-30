import { authWithCheck } from 'app/auth'
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
	PickupOrderDataTable,
	type PickupOrderTableRow,
} from './pickup-order-data-table'

export async function PickupOrderList({
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
		ReturnType<typeof sdk.getPickupOrders>
	>['consumerOrders']['items'] = []
	try {
		const { consumerOrders } = await sdk.getPickupOrders({
			limit: pageSize,
			offset,
		})
		// Filter to pickup orders only
		orders = consumerOrders.items.filter(o => o.fulfillmentMethod === 'pickup')
	} catch {
		// graceful fallback
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
		return `${mp}/${tenant}/store/pickup${search ? `?${search}` : ''}` as Route
	}
	const toRows = (items: typeof filteredOrders): PickupOrderTableRow[] =>
		items.map(order => ({
			id: order.id,
			itemCount: order.items.length,
			pickupDeadline: order.pickupDeadline,
			shippingName: order.shippingName,
			status: order.status,
			totalNanodollar: order.totalNanodollar,
			userId: order.userId,
		}))

	const renderTable = (items: typeof filteredOrders) => (
		<Card>
			<CardContent className='pt-6'>
				<PickupOrderDataTable
					currentPage={currentPage}
					hasNextPage={hasMore}
					nextHref={nextPage ? buildPageUrl(nextPage, status) : undefined}
					orderBaseHref={`${mp}/${tenant}/consumer-orders`}
					previousHref={prevPage ? buildPageUrl(prevPage, status) : undefined}
					rows={toRows(items)}
					tenant={tenant}
				/>
			</CardContent>
		</Card>
	)

	return (
		<div className='flex flex-col gap-4'>
			<Card>
				<CardHeader>
					<CardTitle>店舗受取管理</CardTitle>
					<CardDescription>
						店舗受取注文のステータス管理を行います。
					</CardDescription>
				</CardHeader>
			</Card>

			<Tabs defaultValue={status ?? 'all'}>
				<div className='overflow-x-auto'>
					<TabsList className='w-max sm:w-auto'>
						<TabsTrigger value='all'>
							<Link href={buildPageUrl(1, 'all')}>すべて</Link>
						</TabsTrigger>
						<TabsTrigger value='placed'>
							<Link href={buildPageUrl(1, 'placed')}>注文済み</Link>
						</TabsTrigger>
						<TabsTrigger value='ready'>
							<Link href={buildPageUrl(1, 'ready')}>受取準備完了</Link>
						</TabsTrigger>
						<TabsTrigger value='picked_up'>
							<Link href={buildPageUrl(1, 'picked_up')}>受取完了</Link>
						</TabsTrigger>
						<TabsTrigger value='cancelled'>
							<Link href={buildPageUrl(1, 'cancelled')}>キャンセル</Link>
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value='all'>{renderTable(orders)}</TabsContent>
				<TabsContent value='placed'>
					{renderTable(orders.filter(o => o.status === 'placed'))}
				</TabsContent>
				<TabsContent value='ready'>
					{renderTable(orders.filter(o => o.status === 'ready'))}
				</TabsContent>
				<TabsContent value='picked_up'>
					{renderTable(orders.filter(o => o.status === 'picked_up'))}
				</TabsContent>
				<TabsContent value='cancelled'>
					{renderTable(orders.filter(o => o.status === 'cancelled'))}
				</TabsContent>
			</Tabs>
		</div>
	)
}
