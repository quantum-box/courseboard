import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import Link from 'next/link'
import React from 'react'
import type { ReservationData } from './action'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const paymentStatusLabels: Record<string, string> = {
	not_required: '不要',
	unpaid: '未決済',
	partial: '一部入金',
	paid: '入金済み',
	failed: '決済失敗',
	cancelled: '決済取消',
	refund_pending: '返金待ち',
	refunded: '返金済み',
	fee_due: '手数料請求',
	fee_paid: '手数料入金済み',
}

const actionRequiredPaymentStatuses = new Set([
	'unpaid',
	'partial',
	'failed',
	'cancelled',
	'fee_due',
	'refund_pending',
])

function policyLabels(policy?: Record<string, unknown> | null) {
	const cancellation = String(policy?.cancellationPolicy ?? 'full_refund')
	const prepayment = policy?.prepaymentPolicy ?? policy?.prepaymentType
	const required = Number(policy?.requiredPaymentAmount ?? 0)
	const cancellationLabels: Record<string, string> = {
		full_refund: '全額返金',
		fee_deducted: '手数料差引',
		no_refund: '返金なし',
	}
	return {
		payment:
			prepayment === 'deposit'
				? `デポジット ${yen.format(required)}`
				: prepayment === 'none'
					? '事前決済なし'
					: `全額前払い ${yen.format(required)}`,
		cancellation: cancellationLabels[cancellation] ?? cancellation,
	}
}

function paymentStatusTone(status: string): 'default' | 'secondary' | 'outline' {
	if (status === 'paid' || status === 'fee_paid') {
		return 'default'
	}
	if (status === 'not_required' || status === 'refunded') {
		return 'secondary'
	}
	return 'outline'
}

function hasOpenCheckout(reservation: ReservationData): boolean {
	return Boolean(
		reservation.checkoutUrl &&
			actionRequiredPaymentStatuses.has(reservation.paymentStatus),
	)
}

function paymentShortfall(reservation: ReservationData): number {
	const dueAmount =
		reservation.depositAmount > 0
			? reservation.depositAmount
			: reservation.priceAmount
	return Math.max(dueAmount - reservation.paidAmount, 0)
}

export function ReservationPaymentSummaryContent({
	reservation,
}: {
	reservation: ReservationData
}) {
	const policy = policyLabels(reservation.policySnapshotJson)
	const shortfall = paymentShortfall(reservation)
	const checkoutUrl = hasOpenCheckout(reservation)
		? reservation.checkoutUrl
		: null

	return (
		<div className='grid gap-2 text-sm'>
			<div className='flex flex-wrap items-center gap-2'>
				<Badge variant={paymentStatusTone(reservation.paymentStatus)}>
					{paymentStatusLabels[reservation.paymentStatus] ??
						reservation.paymentStatus}
				</Badge>
				{shortfall > 0 &&
				actionRequiredPaymentStatuses.has(reservation.paymentStatus) ? (
					<span className='text-xs text-destructive'>
						未回収 {yen.format(shortfall)}
					</span>
				) : null}
			</div>
			<div className='grid gap-1 text-xs text-muted-foreground'>
				<p>{policy.payment}</p>
				<p>
					請求 {yen.format(reservation.priceAmount)} / 事前決済{' '}
					{yen.format(reservation.depositAmount)} / 入金{' '}
					{yen.format(reservation.paidAmount)}
				</p>
				<p>取消: {policy.cancellation}</p>
			</div>
			{checkoutUrl ? (
				<Button asChild size='sm' variant='outline' className='w-fit'>
					<Link href={checkoutUrl} target='_blank' rel='noreferrer'>
						{reservation.paymentStatus === 'fee_due'
							? 'キャンセル料支払いリンクを開く'
							: '支払いリンクを開く'}
					</Link>
				</Button>
			) : null}
		</div>
	)
}

export function ReservationPaymentPendingHint({
	reservation,
}: {
	reservation: ReservationData
}) {
	if (
		reservation.status === 'payment_pending' &&
		reservation.paymentStatus === 'unpaid'
	) {
		return (
			<p className='mt-2 text-xs text-muted-foreground'>
				未決済の枠は期限切れ解放ジョブの対象です。支払いリンクがある場合は顧客へ再案内できます。
			</p>
		)
	}
	return null
}
