'use client'

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	type RowData,
	type PaginationState,
	useReactTable,
} from '@tanstack/react-table'
import { Button } from 'components/ui/button'
import {
	Pagination,
	PaginationContent,
	PaginationItem,
} from 'components/ui/pagination'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { cn } from 'lib/utils'
import type { Route } from 'next'
import Link from 'next/link'
import * as React from 'react'

declare module '@tanstack/react-table' {
	interface ColumnMeta<TData, TValue> {
		cellClassName?: string
		headerClassName?: string
	}
}

export type DataTableColumn<TData extends RowData> = ColumnDef<TData>

type DataTablePagination =
	| {
			mode?: 'client'
	  }
	| {
			hasNextPage: boolean
			nextHref?: Route
			page: number
			previousHref?: Route
			mode: 'manual'
	  }

export function DataTable<TData extends RowData>({
	columns,
	data,
	emptyMessage = 'データはありません。',
	getRowHref,
	getRowId,
	initialPage = 1,
	pageSize = 20,
	pagination: paginationMode = { mode: 'client' },
	tableClassName,
}: {
	columns: DataTableColumn<TData>[]
	data: TData[]
	emptyMessage?: string
	getRowHref?: (row: TData) => Route
	getRowId?: (row: TData, index: number) => string
	initialPage?: number
	pageSize?: number
	pagination?: DataTablePagination
	tableClassName?: string
}) {
	const isManualPagination = paginationMode.mode === 'manual'
	const [pagination, setPagination] = React.useState<PaginationState>({
		pageIndex: Math.max(
			isManualPagination ? paginationMode.page - 1 : initialPage - 1,
			0,
		),
		pageSize,
	})
	const table = useReactTable({
		columns,
		data,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: isManualPagination
			? undefined
			: getPaginationRowModel(),
		getRowId,
		manualPagination: isManualPagination,
		onPaginationChange: setPagination,
		state: {
			pagination,
		},
	})
	const rows = table.getRowModel().rows
	const totalItems = data.length
	const totalPages = isManualPagination
		? paginationMode.hasNextPage
			? paginationMode.page + 1
			: Math.max(paginationMode.page, 1)
		: Math.max(table.getPageCount(), 1)
	const currentPage = isManualPagination
		? Math.max(paginationMode.page, 1)
		: Math.min(pagination.pageIndex + 1, totalPages)
	const visibleStart = totalItems === 0 ? 0 : 1
	const visibleEnd = Math.min(
		pagination.pageIndex * pagination.pageSize + rows.length,
		totalItems,
	)
	const canPreviousPage = isManualPagination
		? Boolean(paginationMode.previousHref)
		: table.getCanPreviousPage()
	const canNextPage = isManualPagination
		? paginationMode.hasNextPage && Boolean(paginationMode.nextHref)
		: table.getCanNextPage()

	React.useEffect(() => {
		if (isManualPagination) {
			return
		}
		setPagination(current => {
			const nextPageIndex = Math.min(current.pageIndex, totalPages - 1)
			return nextPageIndex === current.pageIndex
				? current
				: { ...current, pageIndex: nextPageIndex }
		})
	}, [totalPages])

	return (
		<div className='min-w-0'>
			<div className='min-w-0 overflow-x-auto'>
				<Table className={tableClassName}>
					<TableHeader>
						{table.getHeaderGroups().map(headerGroup => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map(header => (
									<TableHead
										className={cn(
											'whitespace-nowrap',
											header.column.columnDef.meta?.headerClassName,
										)}
										key={header.id}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{rows.length === 0 ? (
							<TableRow>
								<TableCell
									className='h-28 text-center text-sm text-muted-foreground'
									colSpan={columns.length}
								>
									{emptyMessage}
								</TableCell>
							</TableRow>
						) : null}
						{rows.map(row => {
							const href = getRowHref?.(row.original)
							return (
								<TableRow
									className={cn(href ? 'cursor-pointer' : undefined)}
									key={row.id}
								>
									{row.getVisibleCells().map(cell => (
										<TableCell
											className={cn(
												href ? 'p-0' : undefined,
												cell.column.columnDef.meta?.cellClassName,
											)}
											key={cell.id}
										>
											{href ? (
												<Link
													className='block h-full p-2 sm:p-4'
													href={href}
													prefetch={false}
												>
													{flexRender(
														cell.column.columnDef.cell,
														cell.getContext(),
													)}
												</Link>
											) : (
												flexRender(cell.column.columnDef.cell, cell.getContext())
											)}
										</TableCell>
									))}
								</TableRow>
							)
						})}
					</TableBody>
				</Table>
			</div>
			<div className='mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
				<p className='text-sm text-muted-foreground'>
					{isManualPagination
						? `${totalItems}件`
						: totalItems === 0
							? '0件'
							: `${totalItems}件中 ${visibleStart}-${visibleEnd}件`}
					<span className='ml-2 tabular-nums'>
						ページ {currentPage} / {totalPages}
					</span>
				</p>
				<Pagination className='justify-start sm:justify-end'>
					<PaginationContent>
						<PaginationItem>
							<Button
								asChild={isManualPagination && canPreviousPage}
								disabled={!canPreviousPage}
								onClick={isManualPagination ? undefined : () => table.previousPage()}
								size='sm'
								type='button'
								variant='outline'
							>
								{isManualPagination && paginationMode.previousHref ? (
									<Link
										href={paginationMode.previousHref}
										prefetch={false}
									>
										前へ
									</Link>
								) : (
									'前へ'
								)}
							</Button>
						</PaginationItem>
						<PaginationItem>
							<Button
								asChild={isManualPagination && canNextPage}
								disabled={!canNextPage}
								onClick={isManualPagination ? undefined : () => table.nextPage()}
								size='sm'
								type='button'
								variant='outline'
							>
								{isManualPagination && paginationMode.nextHref ? (
									<Link href={paginationMode.nextHref} prefetch={false}>
										次へ
									</Link>
								) : (
									'次へ'
								)}
							</Button>
						</PaginationItem>
					</PaginationContent>
				</Pagination>
			</div>
		</div>
	)
}
