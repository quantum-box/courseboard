'use client'

import { Button } from 'components/ui/button'
import type { ReactNode } from 'react'
import { useFormState } from 'react-dom'
import type { ReservationData } from './action'
import {
	ReservationMutationErrorAlert,
	initialReservationMutationActionState,
	type ReservationMutationFormAction,
} from './reservation-mutation-action-state'
import { ReservationPaymentPendingHint } from './reservation-payment-summary'

function PaymentRetryForm({
	action,
	children,
	title,
}: {
	action: ReservationMutationFormAction
	children: ReactNode
	title: string
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)

	return (
		<form action={formAction} className='grid gap-2'>
			<ReservationMutationErrorAlert state={state} title={title} />
			{children}
		</form>
	)
}

export function ReservationPaymentRetryControl({
	refundAction,
	invoiceAction,
	reservation,
}: {
	refundAction: ReservationMutationFormAction
	invoiceAction: ReservationMutationFormAction
	reservation: ReservationData
}) {
	if (reservation.paymentStatus === 'refund_pending') {
		return (
			<PaymentRetryForm
				action={refundAction}
				title='返金の再試行に失敗しました'
			>
				<Button type='submit' variant='outline'>
					返金を再試行
				</Button>
			</PaymentRetryForm>
		)
	}
	if (reservation.paymentStatus === 'fee_due') {
		return (
			<PaymentRetryForm
				action={invoiceAction}
				title='請求書の発行に失敗しました'
			>
				<Button type='submit' variant='outline'>
					請求書を発行
				</Button>
			</PaymentRetryForm>
		)
	}
	if (
		reservation.status === 'payment_pending' &&
		reservation.paymentStatus === 'unpaid'
	) {
		return (
			<div className='grid gap-2'>
				<ReservationPaymentPendingHint reservation={reservation} />
				<PaymentRetryForm
					action={invoiceAction}
					title='請求書の発行に失敗しました'
				>
					<Button type='submit' variant='outline'>
						請求書を発行（後払い）
					</Button>
				</PaymentRetryForm>
			</div>
		)
	}
	return null
}
