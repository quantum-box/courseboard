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

export function ReservationAttendanceControl({
	confirmAction,
	completeAction,
	noShowAction,
	reservation,
	size,
}: {
	confirmAction: ReservationMutationFormAction
	completeAction: ReservationMutationFormAction
	noShowAction: ReservationMutationFormAction
	reservation: ReservationData
	size?: 'sm'
}) {
	const disabled = reservation.status === 'cancelled'
	const isNoShow = reservation.status === 'no_show'
	const compact = size === 'sm'

	return (
		<div className='grid gap-2 text-sm'>
			<div className='grid gap-1'>
				<p className='text-xs font-medium text-muted-foreground'>来場処理</p>
				<p className='text-xs text-muted-foreground'>
					受付・完了・無断不参加を、取消やキャンセル料回収とは分けて記録します。
				</p>
			</div>
			<div
				className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-3 gap-2'}
			>
				<AttendanceActionForm
					action={confirmAction}
					disabled={disabled}
					label='確定'
					size={size}
				/>
				<AttendanceActionForm
					action={completeAction}
					disabled={disabled}
					label='受付/完了'
					size={size}
				/>
				<AttendanceActionForm
					action={noShowAction}
					disabled={disabled}
					label='無断不参加'
					size={size}
					variant={isNoShow ? 'default' : 'outline'}
				/>
			</div>
			{isNoShow ? (
				<p className='text-xs text-destructive'>
					無断不参加として記録済みです。キャンセル料回収が必要な場合は取消処理で金額を残してください。
				</p>
			) : null}
		</div>
	)
}

function AttendanceActionForm({
	action,
	disabled,
	label,
	size,
	variant = 'outline',
}: {
	action: ReservationMutationFormAction
	disabled: boolean
	label: string
	size?: 'sm'
	variant?: 'default' | 'outline'
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)

	return (
		<form action={formAction} className='grid gap-2'>
			<ReservationMutationErrorAlert
				state={state}
				title={`${label}に失敗しました`}
			/>
			<Button type='submit' size={size} variant={variant} disabled={disabled}>
				{label}
			</Button>
		</form>
	)
}
