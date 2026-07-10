import { Button } from 'components/ui/button'
import type { ReceivingDiscrepancyAction } from '../../_lib/erp-api'

const ACTION_OPTIONS: Array<{
	value: ReceivingDiscrepancyAction
	label: string
}> = [
	{ value: 'record_adjustment', label: '在庫調整として記録' },
	{ value: 'return_to_supplier', label: '仕入先へ返品' },
	{ value: 'reorder_required', label: '不足分を再発注' },
	{ value: 'ignore', label: '差異なしとして扱う' },
]

export function DiscrepancyResolutionForm({
	action,
	disabled,
}: {
	action: (formData: FormData) => Promise<void>
	disabled?: boolean
}) {
	return (
		<form action={action} className='grid gap-2 md:grid-cols-[180px_1fr_auto]'>
			<select
				name='action'
				defaultValue='record_adjustment'
				disabled={disabled}
				className='h-11 rounded-md border bg-background px-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:h-9 md:text-sm'
			>
				{ACTION_OPTIONS.map(option => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<input
				name='note'
				placeholder='解消メモ'
				disabled={disabled}
				className='h-11 rounded-md border bg-background px-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:h-9 md:text-sm'
			/>
			<Button
				type='submit'
				size='sm'
				disabled={disabled}
				className='h-11 w-full md:h-9 md:w-auto'
			>
				差異を解消
			</Button>
		</form>
	)
}
