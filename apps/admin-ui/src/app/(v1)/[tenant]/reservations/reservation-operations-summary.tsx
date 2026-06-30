import type { Route } from 'next'
import Link from 'next/link'
import React from 'react'
import type { ReservationData } from './action'

function reservationDayKey(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value.slice(0, 10)
	}
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
		2,
		'0',
	)}-${String(date.getDate()).padStart(2, '0')}`
}

export function ReservationOperationsSummary({
	reservations,
	tenant,
	now = new Date(),
}: {
	reservations: ReservationData[]
	tenant: string
	now?: Date
}) {
	const metrics = buildReservationOperationsMetrics(reservations, now)

	const primaryItems = [
		{
			label: '本日予約',
			value: metrics.todayReservations,
			hint: '今日の受付対象',
			href: `/${tenant}/reservations?status=all` as Route,
		},
		{
			label: '未決済',
			value: metrics.paymentPending,
			hint: '支払い案内が必要',
			href: `/${tenant}/reservations?status=payment_pending` as Route,
		},
		{
			label: '本日未割当',
			value: metrics.todayUnassigned,
			hint: '担当確認が必要',
		},
		{
			label: '完了待ち',
			value: metrics.awaitingCompletion,
			hint: '来場処理の対象',
			href: `/${tenant}/reservations?status=confirmed` as Route,
		},
	]

	return (
		<section aria-label='予約当日オペレーションサマリ' className='grid gap-3'>
			<div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
				{primaryItems.map(item => {
					const content = (
						<div
							key={`${item.label}-content`}
							className='grid h-full gap-1 rounded-md border bg-background p-3 transition hover:bg-muted/30'
						>
							<p className='text-xs font-medium text-muted-foreground'>
								{item.label}
							</p>
							<p className='text-2xl font-semibold'>{item.value}</p>
							<p className='text-xs text-muted-foreground'>{item.hint}</p>
						</div>
					)
					return item.href ? (
						<Link key={item.label} href={item.href} className='block'>
							{content}
						</Link>
					) : (
						<div key={item.label}>{content}</div>
					)
				})}
			</div>
		</section>
	)
}

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export function buildReservationOperationsMetrics(
	reservations: ReservationData[],
	now = new Date(),
) {
	const todayKey = reservationDayKey(now.toISOString())
	const todayReservations = reservations.filter(
		reservation => reservationDayKey(reservation.startsAt) === todayKey,
	)
	const activeTodayReservations = todayReservations.filter(
		reservation => !['cancelled', 'no_show'].includes(reservation.status),
	)
	const paymentPending = reservations.filter(
		reservation =>
			reservation.status === 'payment_pending' ||
			reservation.paymentStatus === 'unpaid',
	).length
	const todayAssigned = activeTodayReservations.filter(
		reservation => reservation.assignedStaffIds.length > 0,
	).length
	const todayUnassigned = activeTodayReservations.filter(
		reservation => reservation.assignedStaffIds.length === 0,
	).length
	const noShow = reservations.filter(
		reservation => reservation.status === 'no_show',
	).length
	const cancelled = reservations.filter(
		reservation => reservation.status === 'cancelled',
	).length
	const awaitingCompletion = todayReservations.filter(reservation =>
		['requested', 'payment_pending', 'confirmed', 'change_requested'].includes(
			reservation.status,
		),
	).length
	const todayRevenueAmount = activeTodayReservations.reduce(
		(total, reservation) => total + reservation.priceAmount,
		0,
	)

	return {
		todayReservations: todayReservations.length,
		paymentPending,
		todayAssigned,
		todayUnassigned,
		noShow,
		cancelled,
		awaitingCompletion,
		todayRevenueAmount,
	}
}
