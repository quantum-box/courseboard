'use client'

import { useEffect, useState } from 'react'
import type { Route } from 'next'
import Link from 'next/link'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { XIcon } from 'lucide-react'
import { GaScopeSummary } from './ga-scope-summary'

const STORAGE_KEY_PREFIX = 'tachyon-field-ga-scope-onboarding-dismissed'

export function GaScopeOnboardingCard({
	tenant,
	modePrefix,
}: {
	tenant: string
	modePrefix: string
}) {
	const storageKey = `${STORAGE_KEY_PREFIX}:${tenant}`
	const [dismissed, setDismissed] = useState(true)

	useEffect(() => {
		setDismissed(window.localStorage.getItem(storageKey) === 'true')
	}, [storageKey])

	const dismiss = () => {
		window.localStorage.setItem(storageKey, 'true')
		setDismissed(true)
	}

	if (dismissed) {
		return null
	}

	return (
		<Card className='border-slate-300 bg-white shadow-sm'>
			<CardHeader className='gap-3 sm:flex-row sm:items-start sm:justify-between'>
				<div className='space-y-1'>
					<CardTitle className='text-lg'>
						TACHYON Field ERP の対応範囲
					</CardTitle>
					<p className='text-sm text-muted-foreground'>
						初回利用時に、GA版で対応する機能と現時点でGAネイティブ機能の範囲外となる領域を確認してください。
					</p>
				</div>
				<Button
					type='button'
					variant='ghost'
					size='icon'
					className='h-8 w-8 shrink-0'
					onClick={dismiss}
					aria-label='対応範囲カードを閉じる'
				>
					<XIcon className='h-4 w-4' />
				</Button>
			</CardHeader>
			<CardContent>
				<GaScopeSummary compact />
			</CardContent>
			<CardFooter className='flex flex-col gap-2 sm:flex-row sm:justify-between'>
				<p className='text-xs text-muted-foreground'>
					閉じた後も設定から再確認できます。
				</p>
				<div className='flex gap-2'>
					<Button asChild variant='outline' size='sm'>
						<Link href={`${modePrefix}/${tenant}/settings/scope` as Route}>
							対応範囲を開く
						</Link>
					</Button>
					<Button type='button' size='sm' onClick={dismiss}>
						確認しました
					</Button>
				</div>
			</CardFooter>
		</Card>
	)
}
