'use client'

import { Button } from 'components/ui/button'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { executePickupAction } from '../actions'

export function PickupActions({
	orderId,
	status,
	tenant,
}: {
	orderId: string
	status: string
	tenant: string
}) {
	const router = useRouter()
	const [isPending, startTransition] = useTransition()

	const handleAction = (action: 'ready' | 'pickup' | 'cancel') => {
		startTransition(async () => {
			const result = await executePickupAction(tenant, orderId, action)
			if (result?.error) {
				console.error(result.error)
			}
			router.refresh()
		})
	}

	return (
		<div className='flex gap-1'>
			{status === 'placed' && (
				<Button
					size='sm'
					variant='default'
					disabled={isPending}
					onClick={() => handleAction('ready')}
				>
					準備完了
				</Button>
			)}
			{status === 'ready' && (
				<Button
					size='sm'
					variant='default'
					disabled={isPending}
					onClick={() => handleAction('pickup')}
					className='bg-teal-600 hover:bg-teal-700'
				>
					受取完了
				</Button>
			)}
			{(status === 'placed' || status === 'ready') && (
				<Button
					size='sm'
					variant='destructive'
					disabled={isPending}
					onClick={() => handleAction('cancel')}
				>
					取消
				</Button>
			)}
		</div>
	)
}
