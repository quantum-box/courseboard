'use client'

import { Button } from 'components/ui/button'
import React from 'react'
import { useFormState } from 'react-dom'
import type { ReservationData } from './action'
import {
	ReservationMutationErrorAlert,
	initialReservationMutationActionState,
	type ReservationMutationFormAction,
} from './reservation-mutation-action-state'

const cancellationPolicyHints: Record<string, string> = {
	full_refund: '全額返金',
	fee_deducted: '手数料差引・決済リンク自動生成',
	no_refund: '返金なし・決済リンク自動生成',
}

function resolvePolicyCancellationType(
	reservation: ReservationData,
): string | null {
	const policy = reservation.policySnapshotJson
	if (!policy) return null
	return (
		String(policy.cancellationPolicy ?? policy.cancellationPolicyType ?? '') ||
		null
	)
}

export function ReservationCancellationControl({
	action,
	reservation,
	size,
}: {
	action: ReservationMutationFormAction
	reservation: ReservationData
	size?: 'sm'
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)
	const disabled = reservation.status === 'cancelled'
	const cancellationType = resolvePolicyCancellationType(reservation)
	const defaultFee = (() => {
		if (reservation.paymentStatus === 'fee_due') {
			return Math.max(reservation.depositAmount - reservation.paidAmount, 0)
		}
		const snap = reservation.policySnapshotJson
		const policyDetail = snap?.cancellationPolicyJson as
			| { refundPolicy?: string }
			| undefined
		const refundPolicy =
			policyDetail?.refundPolicy ?? String(snap?.cancellationPolicy ?? '')
		if (refundPolicy === 'no_refund') {
			return Math.max(reservation.priceAmount - reservation.paidAmount, 0)
		}
		if (refundPolicy === 'fee_deducted') {
			return Math.max(reservation.depositAmount - reservation.paidAmount, 0)
		}
		return 0
	})()

	return (
		<form action={formAction} className='grid min-w-44 gap-2 text-sm'>
			<ReservationMutationErrorAlert
				state={state}
				title='取消処理に失敗しました'
			/>
			{cancellationType ? (
				<p className='text-xs text-muted-foreground'>
					取消ポリシー:{' '}
					{cancellationPolicyHints[cancellationType] ?? cancellationType}
				</p>
			) : null}
			<label className='grid gap-1'>
				<span className='text-xs font-medium text-muted-foreground'>
					キャンセル理由
				</span>
				<input
					name='reason'
					defaultValue='operator cancellation'
					disabled={disabled}
					className='h-9 rounded-md border bg-background px-2 text-sm'
				/>
			</label>
			<div className='grid grid-cols-2 gap-2'>
				<label className='grid gap-1'>
					<span className='text-xs font-medium text-muted-foreground'>
						キャンセル料
					</span>
					<input
						name='cancellationFeeAmount'
						type='number'
						min='0'
						step='1'
						defaultValue={defaultFee}
						disabled={disabled}
						className='h-9 rounded-md border bg-background px-2 text-sm'
					/>
				</label>
				<label className='grid gap-1'>
					<span className='text-xs font-medium text-muted-foreground'>
						返金額
					</span>
					<input
						name='refundAmount'
						type='number'
						min='0'
						step='1'
						placeholder='自動'
						disabled={disabled}
						className='h-9 rounded-md border bg-background px-2 text-sm'
					/>
				</label>
			</div>
			<Button
				type='submit'
				size={size}
				variant='outline'
				disabled={disabled}
				className={size === 'sm' ? 'w-fit' : 'h-11 w-full'}
			>
				取消処理
			</Button>
		</form>
	)
}
