'use client'

import { Button } from 'components/ui/button'
import { Loader2 } from 'lucide-react'
import { useFormStatus } from 'react-dom'

export function CancellationFeeSubmitButton() {
	const { pending } = useFormStatus()

	return (
		<Button type='submit' className='h-10 w-full' disabled={pending}>
			{pending ? (
				<>
					<Loader2 className='mr-2 h-4 w-4 animate-spin' />
					送信中...
				</>
			) : (
				'支払いURLを作成して送信'
			)}
		</Button>
	)
}
