import { Button } from 'components/ui/button'
import { Card, CardContent } from 'components/ui/card'
import Link from 'next/link'
import React from 'react'

export function ConsumerOrderDetailFetchError({
	message,
	listHref,
	retryHref,
}: {
	message: string
	listHref: string
	retryHref: string
}) {
	return (
		<Card className='border-destructive/30 bg-destructive/5'>
			<CardContent className='pt-6'>
				<p className='text-sm font-medium text-destructive'>
					注文データを取得できませんでした
				</p>
				<p className='mt-1 text-sm text-muted-foreground'>{message}</p>
				<div className='mt-3 flex flex-wrap gap-2'>
					<Button asChild variant='outline' size='sm'>
						<Link href={retryHref}>再読み込み</Link>
					</Button>
					<Button asChild variant='ghost' size='sm'>
						<Link href={listHref}>受注管理へ戻る</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}
