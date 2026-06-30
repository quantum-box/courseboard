'use client'

import { Button } from 'components/ui/button'
import { PrinterIcon } from 'lucide-react'

export function PrintInvoiceButton() {
	return (
		<Button type='button' variant='outline' onClick={() => window.print()}>
			<PrinterIcon className='mr-2 h-4 w-4' />
			印刷 / PDF保存
		</Button>
	)
}
