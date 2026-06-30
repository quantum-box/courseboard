import { createStockTransferAction } from 'app/(v1)/[tenant]/inventory/actions'
import {
	listInventoryLocations,
	listStockTransfers,
	type StockTransfer,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { Textarea } from 'components/ui/textarea'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = {
	title: '在庫移動 | TACHYON Field',
	description: 'Stock transfers.',
}

function formatDateTime(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value
	}

	return date.toLocaleString('ja-JP', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function TransferCard({
	transfer,
	locationName,
}: {
	transfer: StockTransfer
	locationName: Map<string, string>
}) {
	return (
		<div className='rounded-lg border bg-background p-4'>
			<div className='flex items-start justify-between gap-3'>
				<div className='min-w-0'>
					<p className='break-all font-mono text-sm font-medium'>
						{transfer.sku}
					</p>
					<p className='mt-1 text-xs text-muted-foreground'>
						{formatDateTime(transfer.transferredAt)}
					</p>
				</div>
				<p className='rounded-md bg-muted px-3 py-1 text-base font-semibold tabular-nums'>
					{transfer.quantity}
				</p>
			</div>
			<div className='mt-4 grid gap-3 text-sm'>
				<div>
					<p className='text-xs text-muted-foreground'>移動元</p>
					<p className='font-medium'>
						{locationName.get(transfer.fromLocationId) ??
							transfer.fromLocationId}
					</p>
				</div>
				<div>
					<p className='text-xs text-muted-foreground'>移動先</p>
					<p className='font-medium'>
						{locationName.get(transfer.toLocationId) ?? transfer.toLocationId}
					</p>
				</div>
				<div>
					<p className='text-xs text-muted-foreground'>理由</p>
					<p>{transfer.reason ?? '-'}</p>
				</div>
			</div>
		</div>
	)
}

export default async function InventoryTransfersPage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)
	let transfersError: string | null = null
	const result = await Promise.all([
		listInventoryLocations(tenant),
		listStockTransfers(tenant),
	]).catch(error => {
		console.error('Failed to load stock transfers:', error)
		transfersError =
			error instanceof Error
				? error.message
				: '在庫移動データを取得できませんでした'
		return null
	})
	const locations = result?.[0].items ?? []
	const transfers = result?.[1].items ?? []
	const action = createStockTransferAction.bind(null, tenant)
	const locationName = new Map(locations.map(item => [item.id, item.name]))

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
							<BreadcrumbPage>在庫移動</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				{!result ? (
					<Card>
						<CardHeader>
							<CardTitle>在庫移動データを取得できませんでした</CardTitle>
							<CardDescription>
								{transfersError ??
									'連携設定を確認のうえ、しばらくしてから再度お試しください。'}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button variant='outline' size='sm' asChild>
								<Link href={`${prefix}/${tenant}/inventory/transfers` as Route}>
									再試行
								</Link>
							</Button>
						</CardContent>
					</Card>
				) : (
					<div className='grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]'>
						<Card>
							<CardHeader>
								<CardTitle>移動を記録</CardTitle>
								<CardDescription>
									BSQ 2F から BSQ 1F への補充などを audit log として残します。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<form action={action} className='space-y-4'>
									<div className='space-y-2'>
										<Label htmlFor='sku'>SKU</Label>
										<Input
											id='sku'
											name='sku'
											required
											placeholder='WAN-SKU-001'
											className='h-11 text-base sm:text-sm'
										/>
									</div>
									<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-1'>
										<div className='space-y-2'>
											<Label>移動元</Label>
											<Select name='fromLocationId' required>
												<SelectTrigger className='h-11 text-base sm:text-sm'>
													<SelectValue placeholder='移動元を選択' />
												</SelectTrigger>
												<SelectContent>
													{locations.map(location => (
														<SelectItem key={location.id} value={location.id}>
															{location.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className='space-y-2'>
											<Label>移動先</Label>
											<Select name='toLocationId' required>
												<SelectTrigger className='h-11 text-base sm:text-sm'>
													<SelectValue placeholder='移動先を選択' />
												</SelectTrigger>
												<SelectContent>
													{locations.map(location => (
														<SelectItem key={location.id} value={location.id}>
															{location.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</div>
									<div className='space-y-2'>
										<Label htmlFor='quantity'>数量</Label>
										<Input
											id='quantity'
											name='quantity'
											required
											type='number'
											min={1}
											inputMode='numeric'
											className='h-11 text-base tabular-nums sm:text-sm'
										/>
									</div>
									<div className='space-y-2'>
										<Label htmlFor='reason'>理由</Label>
										<Textarea
											id='reason'
											name='reason'
											placeholder='1F replenishment'
											className='min-h-24 text-base sm:text-sm'
										/>
									</div>
									<Button type='submit' className='h-11 w-full'>
										記録
									</Button>
								</form>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className='flex flex-row items-start justify-between gap-3'>
								<div>
									<CardTitle>移動履歴</CardTitle>
									<CardDescription>
										拠点間移動の audit log です。
									</CardDescription>
								</div>
							</CardHeader>
							<CardContent>
								{transfers.length === 0 ? (
									<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
										移動履歴はまだありません。
									</div>
								) : (
									<>
										<div className='grid gap-3 md:hidden'>
											{transfers.map(transfer => (
												<TransferCard
													key={transfer.id}
													transfer={transfer}
													locationName={locationName}
												/>
											))}
										</div>
										<div className='hidden md:block'>
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>SKU</TableHead>
														<TableHead>移動元</TableHead>
														<TableHead>移動先</TableHead>
														<TableHead className='text-right'>数量</TableHead>
														<TableHead>理由</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{transfers.map(transfer => (
														<TableRow key={transfer.id}>
															<TableCell className='font-mono text-xs'>
																{transfer.sku}
															</TableCell>
															<TableCell>
																{locationName.get(transfer.fromLocationId) ??
																	transfer.fromLocationId}
															</TableCell>
															<TableCell>
																{locationName.get(transfer.toLocationId) ??
																	transfer.toLocationId}
															</TableCell>
															<TableCell className='text-right tabular-nums'>
																{transfer.quantity}
															</TableCell>
															<TableCell>{transfer.reason ?? '-'}</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										</div>
									</>
								)}
							</CardContent>
						</Card>
					</div>
				)}
			</MainLayout>
		</V1Layout>
	)
}
