'use client'

import { OrderStatusBadge } from 'app/(v1)/[tenant]/consumer-orders/_components/order-status-badge'
import type { DataTableColumn } from 'components/ui/data-table'
import { DataTable } from 'components/ui/data-table'
import { formatNanodollarAsListPrice } from 'lib/format-price'
import type { Route } from 'next'
import Link from 'next/link'
import { PickupActions } from './pickup-actions'

export type PickupOrderTableRow = {
	id: string
	itemCount: number
	pickupDeadline?: string | null
	shippingName?: string | null
	status: string
	totalNanodollar: number | string
	userId?: string | null
}

export function PickupOrderDataTable({
	currentPage,
	hasNextPage,
	nextHref,
	orderBaseHref,
	previousHref,
	rows,
	tenant,
}: {
	currentPage: number
	hasNextPage: boolean
	nextHref?: Route
	orderBaseHref: string
	previousHref?: Route
	rows: PickupOrderTableRow[]
	tenant: string
}) {
	const columns: DataTableColumn<PickupOrderTableRow>[] = [
		{
			accessorKey: 'id',
			header: '注文ID',
			cell: ({ row }) => (
				<div>
					<Link
						href={`${orderBaseHref}/${row.original.id}` as Route}
						className='font-mono text-xs text-blue-600 hover:underline sm:text-sm'
					>
						{row.original.id.slice(0, 12)}...
					</Link>
					<p className='text-xs text-muted-foreground sm:hidden'>
						{row.original.shippingName ?? row.original.userId ?? '-'}
					</p>
				</div>
			),
		},
		{
			id: 'customer',
			header: '顧客名',
			cell: ({ row }) =>
				row.original.shippingName ?? row.original.userId ?? '-',
			meta: {
				cellClassName: 'hidden sm:table-cell text-sm',
				headerClassName: 'hidden sm:table-cell',
			},
		},
		{
			accessorKey: 'status',
			header: 'ステータス',
			cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
		},
		{
			accessorKey: 'itemCount',
			header: '品目数',
			cell: ({ row }) => row.original.itemCount,
			meta: {
				cellClassName: 'hidden md:table-cell text-right',
				headerClassName: 'hidden md:table-cell text-right',
			},
		},
		{
			accessorKey: 'totalNanodollar',
			header: '合計金額',
			cell: ({ row }) => formatNanodollarAsListPrice(row.original.totalNanodollar),
			meta: {
				cellClassName: 'text-right font-mono text-sm',
				headerClassName: 'text-right',
			},
		},
		{
			accessorKey: 'pickupDeadline',
			header: '受取期限',
			cell: ({ row }) =>
				row.original.pickupDeadline
					? new Date(row.original.pickupDeadline).toLocaleDateString('ja-JP')
					: '-',
			meta: {
				cellClassName: 'hidden md:table-cell text-sm text-muted-foreground',
				headerClassName: 'hidden md:table-cell',
			},
		},
		{
			id: 'actions',
			header: '操作',
			cell: ({ row }) => (
				<PickupActions
					orderId={row.original.id}
					status={row.original.status}
					tenant={tenant}
				/>
			),
		},
	]

	return (
		<DataTable
			columns={columns}
			data={rows}
			emptyMessage='受取注文がありません。'
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
