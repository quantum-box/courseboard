'use client'

import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'

export default function InvoicesError({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	return (
		<main className='grid flex-1 items-start gap-4 px-3 py-3 sm:px-6 sm:py-4'>
			<Card className='border-destructive/40 bg-destructive/5'>
				<CardHeader>
					<CardTitle className='flex items-center gap-2 text-destructive'>
						<AlertTriangleIcon className='size-5' />
						請求書画面を表示できませんでした
					</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4 text-sm'>
					<p className='text-muted-foreground'>
						請求/インボイス API または認可状態を確認してください。
					</p>
					{error.message ? (
						<pre className='max-h-40 overflow-auto rounded-md bg-background p-3 text-xs'>
							{error.message}
						</pre>
					) : null}
					<Button type='button' onClick={reset}>
						<RefreshCwIcon className='mr-2 size-4' />
						再読み込み
					</Button>
				</CardContent>
			</Card>
		</main>
	)
}
