import { Button } from 'components/ui/button'
import { FileSpreadsheetIcon } from 'lucide-react'

export function FileUploadButton() {
	return (
		<div className='w-full py-10 bg-zinc-100 rounded-md flex-col justify-center items-center gap-2.5 inline-flex'>
			<Button variant='outline' className='flex items-center gap-2'>
				<FileSpreadsheetIcon className='w-4 h-4' />
				ファイルを選択
			</Button>
		</div>
	)
}
