'use client'

import { Button } from 'components/ui/button'
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useCallback, useState } from 'react'

type ShowKeyDialogProps = {
	apiKey: string
	onClose: () => void
}

export function ShowKeyDialog({ apiKey, onClose }: ShowKeyDialogProps) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(apiKey)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [apiKey])

	return (
		<DialogContent className='sm:max-w-[500px]'>
			<DialogHeader>
				<DialogTitle>APIキーが作成されました</DialogTitle>
				<DialogDescription>
					このAPIキーは一度だけ表示されます。ダイアログを閉じると再表示できません。
				</DialogDescription>
			</DialogHeader>
			<div className='grid gap-4 py-4'>
				<div className='flex items-center gap-2'>
					<Input readOnly value={apiKey} className='font-mono text-sm' />
					<Button
						type='button'
						variant='outline'
						size='icon'
						onClick={handleCopy}
					>
						{copied ? (
							<CheckIcon className='h-4 w-4 text-green-600' />
						) : (
							<CopyIcon className='h-4 w-4' />
						)}
					</Button>
				</div>
				{copied && <p className='text-sm text-green-600'>コピーしました！</p>}
				<p className='text-sm text-destructive'>
					⚠
					このキーを安全な場所に保存してください。再度表示することはできません。
				</p>
			</div>
			<DialogFooter>
				<Button onClick={onClose}>閉じる</Button>
			</DialogFooter>
		</DialogContent>
	)
}
