'use client'

import type { DataTableColumn } from 'components/ui/data-table'
import { DataTable } from 'components/ui/data-table'
import { Badge } from 'components/ui/badge'
import { formatNanodollarAsUsd } from 'lib/format-price'
import type { Route } from 'next'
import Link from 'next/link'
import { OrderStatusBadge } from './order-status-badge'

export type ConsumerOrderTableRow = {
	createdAt: string
	customerEmail?: string | null
	customerId?: string | null
	customerName?: string | null
	fulfillmentMethod?: string | null
	id: string
	itemCount: number
	pickupDeadline?: string | null
	salesChannel?: string | null
	salesChannelDetail?: string | null
	sessionId?: string | null
	shippingName?: string | null
	status: string
	totalNanodollar: number | string
	userId?: string | null
}

export function ConsumerOrderDataTable({
	currentPage,
	hasNextPage,
	nextHref,
	orderBaseHref,
	previousHref,
	rows,
}: {
	currentPage: number
	hasNextPage: boolean
	nextHref?: Route
	orderBaseHref: string
	previousHref?: Route
	rows: ConsumerOrderTableRow[]
}) {
	const columns: DataTableColumn<ConsumerOrderTableRow>[] = [
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
						{customerLabel(row.original)}
					</p>
					<p className='text-xs text-muted-foreground lg:hidden'>
						{formatSalesChannel(row.original.salesChannel)}
					</p>
				</div>
			),
		},
		{
			id: 'customer',
			header: '顧客',
			cell: ({ row }) => (
				<div className='space-y-0.5'>
					<div>{customerLabel(row.original)}</div>
					{row.original.customerId || row.original.customerEmail ? (
						<div className='font-mono text-xs text-muted-foreground'>
							{row.original.customerId ?? row.original.customerEmail}
						</div>
					) : null}
				</div>
			),
			meta: {
				cellClassName: 'hidden sm:table-cell text-sm',
				headerClassName: 'hidden sm:table-cell',
			},
		},
		{
			accessorKey: 'salesChannel',
			header: '販売チャネル',
			cell: ({ row }) => (
				<div>
					<div>{formatSalesChannel(row.original.salesChannel)}</div>
					{row.original.salesChannelDetail ? (
						<div className='text-xs text-muted-foreground'>
							{row.original.salesChannelDetail}
						</div>
					) : null}
				</div>
			),
			meta: {
				cellClassName: 'hidden lg:table-cell text-sm',
				headerClassName: 'hidden lg:table-cell',
			},
		},
		{
			accessorKey: 'status',
			header: 'ステータス',
			cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
		},
		{
			accessorKey: 'fulfillmentMethod',
			header: '受取方法',
			cell: ({ row }) => (
				<FulfillmentMethodBadge method={row.original.fulfillmentMethod} />
			),
			meta: {
				cellClassName: 'hidden md:table-cell',
				headerClassName: 'hidden md:table-cell',
			},
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
			cell: ({ row }) => formatNanodollarAsUsd(row.original.totalNanodollar),
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
				cellClassName: 'hidden lg:table-cell text-sm text-muted-foreground',
				headerClassName: 'hidden lg:table-cell',
			},
		},
		{
			accessorKey: 'createdAt',
			header: '作成日',
			cell: ({ row }) =>
				new Date(row.original.createdAt).toLocaleDateString('ja-JP'),
			meta: {
				cellClassName: 'hidden sm:table-cell text-sm text-muted-foreground',
				headerClassName: 'hidden sm:table-cell',
			},
		},
	]

	return (
		<DataTable
			columns={columns}
			data={rows}
			emptyMessage='注文がありません。'
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

function FulfillmentMethodBadge({ method }: { method?: string | null }) {
	if (method === 'pickup') {
		return (
			<Badge className='bg-teal-100 text-teal-800 hover:bg-teal-200'>
				店舗受取
			</Badge>
		)
	}
	if (method === 'delivery') {
		return (
			<Badge className='bg-blue-100 text-blue-800 hover:bg-blue-200'>
				配送
			</Badge>
		)
	}
	return <Badge variant='outline'>-</Badge>
}

function formatSalesChannel(value?: string | null): string {
	switch (value) {
		case 'online_store':
		case 'online':
		case 'web':
			return 'オンライン'
		case 'physical_store':
		case 'store':
			return '店舗'
		case 'marketplace':
			return 'モール'
		case 'b2b':
			return 'B2B'
		case 'wholesale':
			return '卸'
		default:
			return value ?? '-'
	}
}

function customerLabel(order: ConsumerOrderTableRow) {
	return (
		order.customerName ??
		order.shippingName ??
		order.customerEmail ??
		order.userId ??
		order.sessionId?.slice(0, 8) ??
		'-'
	)
}
