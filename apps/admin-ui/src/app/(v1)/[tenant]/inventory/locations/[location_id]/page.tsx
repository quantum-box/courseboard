import { StockLevelList } from 'app/(v1)/[tenant]/inventory/_components/stock-level-list'
import { listInventoryLocations } from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import { Suspense } from 'react'

export default async function InventoryLocationDetailPage({
	params,
}: {
	params: Promise<{ tenant: string; location_id: string }>
}) {
	const { tenant, location_id: locationId } = await params
	const prefix = getServerModePrefix(tenant)
	const locations = await listInventoryLocations(tenant).catch(() => null)
	const location = locations?.items.find(item => item.id === locationId)

	return (
		<V1Layout
			current='inventory'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink href={`${prefix}/${tenant}/inventory`}>
								在庫管理
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink href={`${prefix}/${tenant}/inventory/locations`}>
								拠点別在庫
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{location?.name ?? locationId}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<Card>
					<CardHeader>
						<CardTitle>{location?.name ?? 'Inventory Location'}</CardTitle>
					</CardHeader>
					<CardContent className='text-sm text-muted-foreground'>
						Location ID: <span className='font-mono'>{locationId}</span>
					</CardContent>
				</Card>
				<Suspense>
					<StockLevelList tenant={tenant} locationId={locationId} />
				</Suspense>
			</MainLayout>
		</V1Layout>
	)
}
