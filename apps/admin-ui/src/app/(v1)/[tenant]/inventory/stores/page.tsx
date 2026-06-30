import { createStoreAction } from 'app/(v1)/[tenant]/inventory/actions'
import { listInventoryStores } from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
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
	title: '店舗マスタ | TACHYON Field',
	description: 'Inventory Store master management.',
}

export default async function InventoryStoresPage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)
	let storesError: string | null = null
	const result = await listInventoryStores(tenant).catch(error => {
		console.error('Failed to load inventory stores:', error)
		storesError =
			error instanceof Error ? error.message : '店舗一覧を取得できませんでした'
		return null
	})
	const items = result?.items ?? []
	const action = createStoreAction.bind(null, tenant)

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
							<BreadcrumbPage>店舗マスタ</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='grid gap-4 lg:grid-cols-[360px_1fr]'>
					<Card>
						<CardHeader>
							<CardTitle>店舗を追加</CardTitle>
							<CardDescription>
								TWS tenant 内で在庫を持つ実店舗を登録します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form action={action} className='space-y-4'>
								<div className='space-y-2'>
									<Label htmlFor='name'>店舗名</Label>
									<Input
										id='name'
										name='name'
										required
										placeholder='BSQ 1F Store'
									/>
								</div>
								<div className='space-y-2'>
									<Label htmlFor='address'>住所</Label>
									<Input
										id='address'
										name='address'
										placeholder='Bernard Square 1F'
									/>
								</div>
								<div className='space-y-2'>
									<Label htmlFor='businessHours'>営業時間</Label>
									<Input
										id='businessHours'
										name='businessHours'
										placeholder='11:00-19:00'
									/>
								</div>
								<div className='space-y-2'>
									<Label htmlFor='posLocationId'>POS location ID</Label>
									<Input
										id='posLocationId'
										name='posLocationId'
										placeholder='Square location ID'
									/>
								</div>
								<Button type='submit'>保存</Button>
							</form>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>店舗一覧</CardTitle>
							<CardDescription>DB 永続化済みの店舗マスタです。</CardDescription>
						</CardHeader>
						<CardContent>
							{!result ? (
								<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
									<p className='font-medium text-foreground'>
										店舗一覧を取得できませんでした
									</p>
									<p className='mt-2'>
										{storesError ??
											'連携設定を確認のうえ、しばらくしてから再度お試しください。'}
									</p>
									<div className='mt-4'>
										<Button variant='outline' size='sm' asChild>
											<Link
												href={`${prefix}/${tenant}/inventory/stores` as Route}
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
											<TableHead>店舗名</TableHead>
											<TableHead>住所</TableHead>
											<TableHead>営業時間</TableHead>
											<TableHead>POS</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{items.map(store => (
											<TableRow key={store.id}>
												<TableCell className='font-medium'>
													{store.name}
												</TableCell>
												<TableCell>{store.address ?? '-'}</TableCell>
												<TableCell>{store.businessHours ?? '-'}</TableCell>
												<TableCell className='font-mono text-xs'>
													{store.posLocationId ?? '-'}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
