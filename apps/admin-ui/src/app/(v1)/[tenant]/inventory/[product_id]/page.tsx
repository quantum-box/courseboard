import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { StockDetail } from './_components/stock-detail'

export default async function InventoryDetailPage({
	params: { tenant, product_id },
}: {
	params: { tenant: string; product_id: string }
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)

	const mp = getServerModePrefix(tenant)
	let detail: Awaited<ReturnType<typeof sdk.getStockDetail>>
	try {
		detail = await sdk.getStockDetail({ productId: product_id })
	} catch {
		redirect(`${mp}/${tenant}/inventory`)
	}

	const { storefrontProduct, productStock } = detail

	const { stockMovements } = await sdk.getStockMovementsForDetail({
		productId: product_id,
		limit: 50,
		offset: 0,
	})

	async function receiveStock(quantity: number, note?: string) {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.receiveStockMutation({
			productId: product_id,
			input: { quantity, note },
		})
		revalidatePath(`/${tenant}/inventory/${product_id}`)
	}

	async function adjustStock(quantity: number, note?: string) {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.adjustStockMutation({
			productId: product_id,
			input: { quantity, note },
		})
		revalidatePath(`/${tenant}/inventory/${product_id}`)
	}

	async function issueStock(quantity: number, note?: string) {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.issueStockMutation({
			productId: product_id,
			input: { quantity, note },
		})
		revalidatePath(`/${tenant}/inventory/${product_id}`)
	}

	async function updateReorderPoint(reorderPoint: number) {
		'use server'
		const s = await authWithCheck()
		const sdk = getGraphqlSdk(s, tenant)
		await sdk.updateReorderPointMutation({
			productId: product_id,
			input: { reorderPoint },
		})
		revalidatePath(`/${tenant}/inventory/${product_id}`)
		revalidatePath(`/${tenant}/inventory`)
	}

	return (
		<V1Layout
			current='inventory'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/inventory` as Route}>
									在庫管理
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{storefrontProduct.name}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<StockDetail
					product={{
						id: storefrontProduct.id,
						name: storefrontProduct.name,
						kind: storefrontProduct.kind,
						listPrice: storefrontProduct.listPrice,
						billingCycle: storefrontProduct.billingCycle,
					}}
					stock={productStock}
					movements={stockMovements.items}
					tenant={tenant}
					onReceiveStock={receiveStock}
					onIssueStock={issueStock}
					onAdjustStock={adjustStock}
					onUpdateReorderPoint={updateReorderPoint}
				/>
			</MainLayout>
		</V1Layout>
	)
}
