import { listInventoryLocations } from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = {
	title: '拠点別在庫 | TACHYON Field',
	description: 'Inventory locations.',
}

export default async function InventoryLocationsPage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)
	let locationsError: string | null = null
	const result = await listInventoryLocations(tenant).catch(error => {
		console.error('Failed to load inventory locations:', error)
		locationsError =
			error instanceof Error ? error.message : '拠点一覧を取得できませんでした'
		return null
	})
	const items = result?.items ?? []

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
							<BreadcrumbPage>拠点別在庫</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<Card>
					<CardHeader className='flex flex-row items-start justify-between gap-3'>
						<div>
							<CardTitle>Inventory Locations</CardTitle>
							<CardDescription>
								Warehouse と Store を共通の在庫拠点として扱います。
							</CardDescription>
						</div>
					</CardHeader>
					<CardContent>
						{!result ? (
							<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
								<p className='font-medium text-foreground'>
									拠点一覧を取得できませんでした
								</p>
								<p className='mt-2'>
									{locationsError ??
										'連携設定を確認のうえ、しばらくしてから再度お試しください。'}
								</p>
								<div className='mt-4'>
									<Button variant='outline' size='sm' asChild>
										<Link
											href={`${prefix}/${tenant}/inventory/locations` as Route}
										>
											再試行
										</Link>
									</Button>
								</div>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>拠点名</TableHead>
										<TableHead>種別</TableHead>
										<TableHead>Location ID</TableHead>
										<TableHead className='w-[120px]'>在庫</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{items.map(location => (
										<TableRow key={location.id}>
											<TableCell className='font-medium'>
												{location.name}
											</TableCell>
											<TableCell>
												<Badge variant='secondary'>{location.kind}</Badge>
											</TableCell>
											<TableCell className='font-mono text-xs'>
												{location.id}
											</TableCell>
											<TableCell>
												<Button size='sm' variant='outline' asChild>
													<Link
														href={
															`${prefix}/${tenant}/inventory/locations/${location.id}` as Route
														}
													>
														表示
													</Link>
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}
