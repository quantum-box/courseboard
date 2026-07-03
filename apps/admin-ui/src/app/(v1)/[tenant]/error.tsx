'use client'

import * as Sentry from '@sentry/nextjs'
import { SideMenu, SideMenuSheet } from 'components/side-menu'
import { Button } from 'components/ui/button'
import { useModePrefix } from 'hooks/useMode'
import { useTenantId } from 'hooks/useTenantId'
import { AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function TenantErrorPage({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	const tenantId = useTenantId()
	const modePrefix = useModePrefix()
	const router = useRouter()

	useEffect(() => {
		Sentry.captureException(error)
		console.error(error)
	}, [error])

	return (
		<div className='flex min-h-screen w-full flex-col bg-muted/40'>
			<SideMenu modePrefix={modePrefix} tenantId={tenantId} />
			<div className='flex flex-col sm:gap-4 sm:py-4 sm:pl-48'>
				<header className='sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6'>
					<SideMenuSheet modePrefix={modePrefix} tenantId={tenantId} />
				</header>
				<main className='grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8'>
					<div className='flex flex-col items-center justify-center py-12'>
						<AlertCircle className='h-12 w-12 text-destructive mb-4' />
						<h2 className='text-xl font-semibold mb-2'>エラーが発生しました</h2>
						<p className='text-sm text-muted-foreground mb-6'>
							ページの表示中に問題が発生しました。送信操作の失敗は画面内のエラー表示を確認してください。
						</p>
						{error.message ? (
							<pre className='mb-4 max-h-40 max-w-full overflow-auto rounded-md border bg-background p-3 text-left text-xs text-foreground'>
								{error.message}
							</pre>
						) : null}
						{error.digest ? (
							<p className='mb-4 text-xs text-muted-foreground'>
								Error digest: {error.digest}
							</p>
						) : null}
						<div className='flex gap-2'>
							<Button type='button' variant='outline' onClick={reset}>
								再読み込み
							</Button>
							<Button onClick={() => router.replace('/auth/sign_out')}>
								ログアウト
							</Button>
							<Button variant='outline' asChild>
								<Link href={`${modePrefix}/${tenantId}/home`}>
									ホームに戻る
								</Link>
							</Button>
						</div>
					</div>
				</main>
			</div>
		</div>
	)
}
