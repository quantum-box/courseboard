'use client'

import { Button } from 'components/ui/button'
import { DownloadIcon } from 'lucide-react'
import React from 'react'
import { downloadCaddiePayrollCsvAction } from './action'

export function CaddiePayrollExportButton({
	tenant,
	yearMonth,
}: {
	tenant: string
	yearMonth: string
}) {
	return (
		<Button
			type='button'
			size='sm'
			variant='outline'
			onClick={async () => {
				const result = await downloadCaddiePayrollCsvAction(tenant, yearMonth)
				if (!result.success) {
					window.alert(result.message ?? 'CSV出力に失敗しました')
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
			}}
		>
			<DownloadIcon className='mr-2 h-4 w-4' aria-hidden />
			給与CSVを出力
		</Button>
	)
}
