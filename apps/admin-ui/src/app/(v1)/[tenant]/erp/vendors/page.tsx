import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { PlusIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchVendorsAction, type VendorData } from './actions'

const statusLabels: Record<string, string> = {
	Active: '有効',
	Inactive: '停止',
}

export default async function VendorsPage({
	params: { tenant },
	searchParams: { status = 'all', search = '' },
}: {
	params: { tenant: string }
	searchParams: { status?: string; search?: string }
}) {
	const result = await fetchVendorsAction(tenant, status, search)
	const vendors = result.data ?? []

	return (
		<V1Layout current='vendors' tenant={tenant}>
			<MainLayout>
				<div className='flex items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>仕入先</h1>
						<p className='text-sm text-muted-foreground'>
							発注書で利用する仕入先マスタを管理します。
						</p>
					</div>
					<Button asChild>
						<Link href={`/${tenant}/erp/vendors/new` as Route}>
							<PlusIcon className='mr-2 h-4 w-4' />
							新規作成
						</Link>
					</Button>
				</div>
				<div className='flex flex-wrap gap-2'>
					{['all', 'Active', 'Inactive'].map(value => (
						<Button
							key={value}
							variant={status === value ? 'default' : 'outline'}
							size='sm'
							asChild
						>
							<Link href={`/${tenant}/erp/vendors?status=${value}` as Route}>
								{value === 'all' ? 'すべて' : statusLabels[value]}
							</Link>
						</Button>
					))}
				</div>
				<Card>
					<CardHeader>
						<CardTitle>仕入先一覧</CardTitle>
					</CardHeader>
					<CardContent>
						<VendorTable vendors={vendors} tenant={tenant} />
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}

function VendorTable({
	vendors,
	tenant,
}: {
	vendors: VendorData[]
	tenant: string
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>仕入先</TableHead>
					<TableHead>連絡先</TableHead>
					<TableHead>支払条件</TableHead>
					<TableHead>ステータス</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{vendors.length === 0 ? (
					<TableRow>
						<TableCell colSpan={4} className='h-24 text-center'>
							仕入先はありません。
						</TableCell>
					</TableRow>
				) : null}
				{vendors.map(vendor => (
					<TableRow key={vendor.id}>
						<TableCell>
							<Link
								className='font-medium hover:underline'
								href={`/${tenant}/erp/vendors/${vendor.id}` as Route}
							>
								{vendor.name}
							</Link>
							<div className='text-xs text-muted-foreground'>{vendor.id}</div>
						</TableCell>
						<TableCell>
							<div>{vendor.contactName ?? '-'}</div>
							<div className='text-xs text-muted-foreground'>
								{vendor.contactEmail ?? vendor.contactPhone ?? ''}
							</div>
						</TableCell>
						<TableCell>{vendor.paymentTerms ?? '-'}</TableCell>
						<TableCell>
							<Badge
								variant={vendor.status === 'Active' ? 'secondary' : 'outline'}
							>
								{statusLabels[vendor.status] ?? vendor.status}
							</Badge>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}
