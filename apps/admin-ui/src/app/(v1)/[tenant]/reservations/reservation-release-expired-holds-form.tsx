'use client'

import { RefreshCwIcon } from 'lucide-react'
import { Button } from 'components/ui/button'
import { useFormState } from 'react-dom'
import {
	ReservationMutationErrorAlert,
	initialReservationMutationActionState,
	type ReservationMutationFormAction,
} from './reservation-mutation-action-state'

export function ReservationReleaseExpiredHoldsForm({
	action,
}: {
	action: ReservationMutationFormAction
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)

	return (
		<form action={formAction} className='grid gap-2'>
			<ReservationMutationErrorAlert
				state={state}
				title='期限切れ枠の解放に失敗しました'
			/>
			<Button type='submit' variant='outline' className='w-full lg:w-auto'>
				<RefreshCwIcon className='mr-2 h-4 w-4' />
				期限切れ枠を解放
			</Button>
		</form>
	)
}
