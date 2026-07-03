import type { Route } from 'next'
import Link from 'next/link'
import React from 'react'
import type { ReservationData } from './action'

function consumerHref(tenant: string, email?: string | null): Route | null {
	if (!email) {
		return null
	}
	return `/${tenant}/library/consumers?email=${encodeURIComponent(email)}` as Route
}

export function ReservationCustomerLink({
	reservation,
	tenant,
	compact = false,
}: {
	reservation: ReservationData
	tenant: string
	compact?: boolean
}) {
	const href = consumerHref(tenant, reservation.customerEmail)
	const label =
		reservation.customerName ??
		reservation.customerEmail ??
		reservation.customerPhone ??
		'顧客未設定'

	return (
		<div className='grid min-w-0 gap-1'>
			{href ? (
				<Link
					href={href}
					className='min-w-0 truncate font-medium text-primary underline-offset-4 hover:underline'
				>
					{label}
				</Link>
			) : (
				<p className='min-w-0 truncate font-medium'>{label}</p>
			)}
			{compact ? null : (
				<div className='grid gap-0.5 text-xs text-muted-foreground'>
					{reservation.customerEmail ? (
						<p className='break-all'>{reservation.customerEmail}</p>
					) : null}
					{reservation.customerPhone ? <p>{reservation.customerPhone}</p> : null}
					{reservation.customerId ? (
						<p className='break-all'>ID: {reservation.customerId}</p>
					) : null}
					{href ? <p>コンシューマーで確認</p> : null}
				</div>
			)}
		</div>
	)
}
