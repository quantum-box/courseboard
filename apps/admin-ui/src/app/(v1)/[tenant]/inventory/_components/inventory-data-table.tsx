'use client'

import type { DataTableColumn } from 'components/ui/data-table'
import { DataTable } from 'components/ui/data-table'
import { Badge } from 'components/ui/badge'
import { Kind } from 'lib/product-constants'
import type { Route } from 'next'
import Link from 'next/link'

export type InventoryTableRow = {
	id: string
	available?: number | null
	kind?: string | null
	lowStockThreshold?: number | null
	name: string
	onHand?: number | null
	reserved?: number | null
	trackInventory?: boolean | null
}

export function InventoryDataTable({
	currentPage,
	hasNextPage,
	nextHref,
	previousHref,
	rows,
	tenantInventoryBaseHref,
}: {
	currentPage: number
	hasNextPage: boolean
	nextHref?: Route
	previousHref?: Route
	rows: InventoryTableRow[]
	tenantInventoryBaseHref: string
}) {
	const columns: DataTableColumn<InventoryTableRow>[] = [
		{
			accessorKey: 'name',
			header: '商品名',
			cell: ({ row }) => {
				const isPlan = row.original.kind === Kind.Plan
				return (
					<div>
						<Link
							href={`${tenantInventoryBaseHref}/${row.original.id}` as Route}
							className='font-medium text-blue-600 hover:underline'
						>
							{row.original.name}
						</Link>
						<span className='block text-xs text-muted-foreground sm:hidden'>
							{inventoryKindLabel(row.original.kind, isPlan)}
						</span>
					</div>
				)
			},
			meta: {
				cellClassName: 'min-w-[180px]',
				headerClassName: 'min-w-[180px]',
			},
		},
		{
			accessorKey: 'kind',
			header: '種別',
			cell: ({ row }) => inventoryKindBadge(row.original.kind),
			meta: {
				cellClassName: 'hidden sm:table-cell w-[80px]',
				headerClassName: 'hidden sm:table-cell w-[80px]',
			},
		},
		{
			accessorKey: 'onHand',
			header: '手持在庫',
			cell: ({ row }) =>
				inventoryNumber(row.original.onHand, row.original.kind),
			meta: {
				cellClassName: 'hidden md:table-cell text-right tabular-nums w-[80px]',
				headerClassName: 'hidden md:table-cell text-right w-[80px]',
			},
		},
		{
			accessorKey: 'reserved',
			header: '予約在庫',
			cell: ({ row }) =>
				inventoryNumber(row.original.reserved, row.original.kind),
			meta: {
				cellClassName: 'hidden lg:table-cell text-right tabular-nums w-[80px]',
				headerClassName: 'hidden lg:table-cell text-right w-[80px]',
			},
		},
		{
			accessorKey: 'available',
			header: '利用可能',
			cell: ({ row }) =>
				inventoryNumber(row.original.available, row.original.kind),
			meta: {
				cellClassName: 'text-right tabular-nums w-[80px]',
				headerClassName: 'text-right w-[80px]',
			},
		},
		{
			accessorKey: 'lowStockThreshold',
			header: '閾値',
			cell: ({ row }) =>
				inventoryNumber(row.original.lowStockThreshold, row.original.kind),
			meta: {
				cellClassName: 'hidden md:table-cell text-right tabular-nums w-[60px]',
				headerClassName: 'hidden md:table-cell text-right w-[60px]',
			},
		},
		{
			id: 'status',
			header: 'ステータス',
			cell: ({ row }) => stockStatusBadge(row.original),
			meta: {
				cellClassName: 'w-[120px]',
				headerClassName: 'w-[120px]',
			},
		},
	]

	return (
		<DataTable
			columns={columns}
			data={rows}
			emptyMessage='在庫データがありません。まず製品を登録してください。'
			getRowId={row => row.id}
			pagination={{
				hasNextPage,
				mode: 'manual',
				nextHref,
				page: currentPage,
				previousHref,
			}}
		/>
	)
}

function inventoryKindLabel(kind?: string | null, isPlan = kind === Kind.Plan) {
	if (isPlan) return '非在庫'
	return kind === Kind.Option ? 'オプション' : '在庫商品'
}

function inventoryKindBadge(kind?: string | null) {
	if (kind === Kind.Plan) {
		return (
			<Badge variant='secondary' className='text-[10px]'>
				非在庫
			</Badge>
		)
	}
	if (kind === Kind.Option) {
		return (
			<Badge variant='outline' className='text-[10px]'>
				オプション
			</Badge>
		)
	}
	return (
		<Badge variant='outline' className='text-[10px]'>
			在庫商品
		</Badge>
	)
}

function inventoryNumber(value?: number | null, kind?: string | null) {
	if (kind === Kind.Plan) {
		return <span className='text-muted-foreground'>-</span>
	}
	return value ?? '-'
}

function stockStatusBadge(row: InventoryTableRow) {
	if (row.kind === Kind.Plan) {
		return (
			<Badge variant='secondary' className='whitespace-nowrap'>
				非在庫商品
			</Badge>
		)
	}
	if (row.available == null || row.lowStockThreshold == null) {
		return <Badge variant='outline'>未設定</Badge>
	}
	if (!row.trackInventory) {
		return <Badge variant='secondary'>追跡なし</Badge>
	}
	if (row.available <= 0) {
		return <Badge variant='destructive'>在庫切れ</Badge>
	}
	if (row.available <= row.lowStockThreshold) {
		return (
			<Badge className='bg-yellow-100 text-yellow-800 hover:bg-yellow-200'>
				低在庫
			</Badge>
		)
	}
	return (
		<Badge className='bg-green-100 text-green-800 hover:bg-green-200'>
			在庫あり
		</Badge>
	)
}
