import { Button } from 'components/ui/button'
import { CheckCircle2Icon } from 'lucide-react'

export function CommitReceivingForm({
	action,
	disabled,
}: {
	action: () => Promise<void>
	disabled?: boolean
}) {
	return (
		<form action={action} className='w-full space-y-2 sm:w-auto'>
			<Button
				type='submit'
				disabled={disabled}
				className='h-11 w-full gap-2 sm:w-auto'
			>
				<CheckCircle2Icon className='h-4 w-4' />
				検収確定
			</Button>
		</form>
	)
}
