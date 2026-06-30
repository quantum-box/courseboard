import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { ToastClient } from 'components/toast-client'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { ConsumerOrderDetailFetchError } from './_components/consumer-order-detail-fetch-error'
import { OrderDetail } from './_components/order-detail'

export default async function ConsumerOrderDetailPage({
	params: { tenant, order_id },
}: {
	params: { tenant: string; order_id: string }
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)

	const mp = getServerModePrefix(tenant)
	let result: Awaited<ReturnType<typeof sdk.getConsumerOrderDetail>> | undefined
	let loadError: string | undefined
	try {
		result = await sdk.getConsumerOrderDetail({ orderId: order_id })
	} catch (error) {
		console.error('Failed to load consumer order detail', error)
		loadError =
			'注文データの取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
	}

	async function cancelOrder() {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.cancelConsumerOrderMutation({ orderId: order_id })
		revalidatePath(`/${tenant}/consumer-orders/${order_id}`)
	}

	async function confirmOrder() {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.confirmConsumerOrderMutation({ orderId: order_id })
		revalidatePath(`/${tenant}/consumer-orders/${order_id}`)
	}

	async function prepareOrder() {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.prepareConsumerOrderMutation({ orderId: order_id })
		revalidatePath(`/${tenant}/consumer-orders/${order_id}`)
	}

	async function shipOrder() {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.shipConsumerOrderMutation({ orderId: order_id })
		revalidatePath(`/${tenant}/consumer-orders/${order_id}`)
	}

	async function deliverOrder() {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.deliverConsumerOrderMutation({ orderId: order_id })
		revalidatePath(`/${tenant}/consumer-orders/${order_id}`)
	}

	async function refundOrder() {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.refundConsumerOrderMutation({ orderId: order_id })
		revalidatePath(`/${tenant}/consumer-orders/${order_id}`)
	}

	return (
		<V1Layout
			current='consumer-orders'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/consumer-orders` as Route}>
									受注管理
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>
								{result?.consumerOrder
									? `${result.consumerOrder.id.slice(0, 16)}...`
									: '取得エラー'}
							</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				{result?.consumerOrder ? (
					<OrderDetail
						order={result.consumerOrder}
						tenant={tenant}
						onCancel={cancelOrder}
						onConfirm={confirmOrder}
						onPrepare={prepareOrder}
						onShip={shipOrder}
						onDeliver={deliverOrder}
						onRefund={refundOrder}
					/>
				) : (
					<>
						<ConsumerOrderDetailFetchError
							message={
								loadError ??
								'注文データの取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
							}
							listHref={`${mp}/${tenant}/consumer-orders`}
							retryHref={`${mp}/${tenant}/consumer-orders/${order_id}`}
						/>
						<ToastClient
							title='注文データを取得できませんでした'
							description={
								loadError ??
								'注文データの取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
							}
							variant='destructive'
						/>
					</>
				)}
			</MainLayout>
		</V1Layout>
	)
}
