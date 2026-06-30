'use client'

import { Button } from 'components/ui/button'
import { DownloadIcon } from 'lucide-react'
import React from 'react'
import { downloadGolfMonthlySettlementCsvAction } from './action'

export function SettlementExportButton({
	tenant,
	yearMonth,
}: {
	tenant: string
	yearMonth: string
}) {
	const [pending, startTransition] = React.useTransition()
	const [error, setError] = React.useState<string | null>(null)

	return (
		<div className='grid gap-2'>
			<Button
				type='button'
				size='sm'
				variant='outline'
				disabled={pending}
				onClick={() => {
					setError(null)
					startTransition(async () => {
						const result = await downloadGolfMonthlySettlementCsvAction(
							tenant,
							yearMonth,
						)
						if (!result.success) {
							setError(result.message)
							return
						}
						const blob = new Blob([result.csv], {
							type: 'text/csv;charset=utf-8',
						})
						const url = URL.createObjectURL(blob)
						const anchor = document.createElement('a')
						anchor.href = url
						anchor.download = result.filename
						anchor.click()
						URL.revokeObjectURL(url)
					})
				}}
			>
				<DownloadIcon className='mr-2 h-4 w-4' aria-hidden />
				CSVを出力
			</Button>
			{error ? <p className='text-xs text-destructive'>{error}</p> : null}
		</div>
	)
}
