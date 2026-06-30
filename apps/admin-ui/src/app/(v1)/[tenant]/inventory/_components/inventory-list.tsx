import { authWithCheck } from 'app/auth'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import {
	InventoryDataTable,
	type InventoryTableRow,
} from './inventory-data-table'

export async function InventoryList({
	searchParams: { page },
	tenant,
}: {
	searchParams: { page?: string }
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

	let products: Awaited<
		ReturnType<typeof sdk.getInventoryList>
	>['storefrontProducts']['items'] = []
	try {
		const { storefrontProducts } = await sdk.getInventoryList({
			limit: pageSize,
			offset,
		})
		products = storefrontProducts?.items ?? []
	} catch {
		// New tenant may not have inventory data yet
	}

	// Fetch stock for each product in parallel
	const stockResults = await Promise.all(
		products.map(p =>
			sdk
				.getProductStockForList({ productId: p.id })
				.then(r => ({ productId: p.id, stock: r.productStock }))
				.catch(() => ({
					productId: p.id,
					stock: null,
				})),
		),
	)
	const stockMap = new Map(stockResults.map(r => [r.productId, r.stock]))

	const prevPage = currentPage > 1 ? currentPage - 1 : null
	const hasMore = products.length >= pageSize
	const nextPage = hasMore ? currentPage + 1 : null
	const rows: InventoryTableRow[] = products.map(product => {
		const stock = stockMap.get(product.id)
		return {
			available: stock?.quantityAvailable,
			id: product.id,
			kind: product.kind,
			lowStockThreshold: stock?.lowStockThreshold,
			name: product.name,
			onHand: stock?.quantityOnHand,
			reserved: stock?.quantityReserved,
			trackInventory: stock?.trackInventory,
		}
	})

	const buildPageUrl = (targetPage: number) => {
		const params = new URLSearchParams()
		if (targetPage > 1) params.set('page', String(targetPage))
		const search = params.toString()
		return `${mp}/${tenant}/inventory${search ? `?${search}` : ''}` as Route
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>在庫一覧</CardTitle>
				<CardDescription>
					商品ごとの在庫状況を管理します。非在庫商品（サービス・サブスクリプション等）は在庫追跡の対象外です。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<InventoryDataTable
					currentPage={currentPage}
					hasNextPage={hasMore}
					nextHref={nextPage ? buildPageUrl(nextPage) : undefined}
					previousHref={prevPage ? buildPageUrl(prevPage) : undefined}
					rows={rows}
					tenantInventoryBaseHref={`${mp}/${tenant}/inventory`}
				/>
			</CardContent>
		</Card>
	)
}
