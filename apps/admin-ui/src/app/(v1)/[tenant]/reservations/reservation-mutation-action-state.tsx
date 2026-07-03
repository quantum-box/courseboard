'use client'

import type { ReservationMutationActionState } from './action'

export const initialReservationMutationActionState: ReservationMutationActionState =
	{ status: 'idle' }

export type ReservationMutationFormAction = (
	state: ReservationMutationActionState,
	formData: FormData,
) => Promise<ReservationMutationActionState>

export function ReservationMutationErrorAlert({
	state,
	title = '操作に失敗しました',
}: {
	state: ReservationMutationActionState
	title?: string
}) {
	if (state.status !== 'error' || !state.message) {
		return null
	}

	return (
		<div
			role='alert'
			className='space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
		>
			<p className='font-medium'>{title}</p>
			<p>{state.message}</p>
			{state.statusCode ? (
				<p className='text-xs'>Field API status: {state.statusCode}</p>
			) : null}
		</div>
	)
}
