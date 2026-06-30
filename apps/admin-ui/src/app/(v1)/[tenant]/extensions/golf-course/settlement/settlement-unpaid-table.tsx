'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { ExternalLinkIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import React from 'react'
import { issueGolfCancellationSquareInvoiceAction } from './action'
import {
	type GolfUnpaidCancellationItem,
	formatYen,
} from './settlement-helpers'

export function SettlementUnpaidCancellationsTable({
	tenant,
	items,
}: {
	tenant: string
	items: GolfUnpaidCancellationItem[]
}) {
	const [pendingId, setPendingId] = React.useState<string | null>(null)
	const [error, setError] = React.useState<string | null>(null)
	const [lastIssuedUrl, setLastIssuedUrl] = React.useState<string | null>(null)

	if (items.length === 0) {
		return (
			<p className='text-sm text-muted-foreground'>
				この期間の未収キャンセル料はありません。
			</p>
		)
	}

	return (
		<div className='grid gap-3'>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>予約</TableHead>
						<TableHead>状態</TableHead>
						<TableHead className='text-right'>手数料</TableHead>
						<TableHead>請求</TableHead>
						<TableHead className='text-right'>操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map(item => (
						<TableRow key={item.reservationId}>
							<TableCell>
								<Link
									href={
										`/${tenant}/reservations/${item.reservationId}` as Route
									}
									className='font-medium hover:underline'
								>
									{item.reservationNumber}
								</Link>
							</TableCell>
							<TableCell>
								<Badge
									variant={
										item.paymentStatus === 'fee_paid'
											? 'default'
											: 'destructive'
									}
								>
									{item.paymentStatus}
								</Badge>
							</TableCell>
							<TableCell className='text-right'>
								{formatYen(item.cancellationFeeAmount)}
							</TableCell>
							<TableCell>
								{item.linkIssued ? (
									<Badge variant='secondary'>発行済み</Badge>
								) : (
									<Badge variant='outline'>未発行</Badge>
								)}
							</TableCell>
							<TableCell className='text-right'>
								<div className='flex flex-wrap justify-end gap-2'>
									{item.checkoutUrl ? (
										<Button variant='outline' size='sm' asChild>
											<a
												href={item.checkoutUrl}
												target='_blank'
												rel='noreferrer'
											>
												<ExternalLinkIcon
													className='mr-2 h-4 w-4'
													aria-hidden
												/>
												開く
											</a>
										</Button>
									) : null}
									<Button
										type='button'
										size='sm'
										variant='outline'
										disabled={pendingId === item.reservationId}
										onClick={() => {
											setError(null)
											setLastIssuedUrl(null)
											setPendingId(item.reservationId)
											void issueGolfCancellationSquareInvoiceAction(
												tenant,
												item.reservationId,
											).then(result => {
												setPendingId(null)
												if (!result.success) {
													setError(result.message)
													return
												}
												setLastIssuedUrl(result.checkoutUrl)
											})
										}}
									>
										{pendingId === item.reservationId
											? '発行中...'
											: '請求書を発行'}
									</Button>
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{error ? <p className='text-sm text-destructive'>{error}</p> : null}
			{lastIssuedUrl ? (
				<p className='text-sm text-muted-foreground'>
					決済URL:{' '}
					<a
						href={lastIssuedUrl}
						className='text-primary underline'
						target='_blank'
						rel='noreferrer'
					>
						{lastIssuedUrl}
					</a>
				</p>
			) : null}
		</div>
	)
}
