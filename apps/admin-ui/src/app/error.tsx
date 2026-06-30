'use client' // Error components must be Client Components

import * as Sentry from '@sentry/nextjs'
import { NextAuthProvider } from 'app/auth-client'
import { SideMenu, SideMenuSheet } from 'components/side-menu'
import { Button } from 'components/ui/button'
import { useToast } from 'components/ui/use-toast'
import { getModeFromOperatorId, getServerModePrefix } from 'lib/mode'
import { useSession } from 'next-auth/react'
import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function ErrorPage({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	return (
		<NextAuthProvider>
			<ErrorPageComponent error={error} reset={reset} />
		</NextAuthProvider>
	)
}

function ErrorPageComponent({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	const { toast } = useToast()
	const router = useRouter()
	const { data: session } = useSession()
	const params = useParams<{ tenant?: string }>()
	const tenant = params?.tenant

	if (
		session?.error === 'RefreshAccessTokenError' ||
		session?.error === 'VerifyAccessTokenError'
	) {
		toast({
			title: 'エラーが発生しました',
			description: 'ログアウトします',
		})
		router.replace('/auth/sign_out')
	}

	useEffect(() => {
		Sentry.captureException(error)
		console.error(error)
	}, [error])

	if (!tenant) {
		return (
			<main className='flex min-h-screen items-center justify-center'>
				<div className='max-w-lg space-y-4 text-center'>
					<h2 className='text-xl font-semibold mb-4'>エラーが発生しました</h2>
					{error.message ? (
						<pre className='max-h-40 max-w-full overflow-auto rounded-md border bg-background p-3 text-left text-xs'>
							{error.message}
						</pre>
					) : null}
					{error.digest ? (
						<p className='text-xs text-muted-foreground'>
							Error digest: {error.digest}
						</p>
					) : null}
					<div className='flex gap-2 justify-center'>
						<Button type='button' variant='outline' onClick={reset}>
							再読み込み
						</Button>
						<Button onClick={() => router.replace('/auth/sign_out')}>
							ログアウト
						</Button>
					</div>
				</div>
			</main>
		)
	}

	const modePrefix = getServerModePrefix(tenant)
	const tenantMode = getModeFromOperatorId(tenant)

	return (
		<div className='flex min-h-screen w-full flex-col bg-muted/40'>
			<SideMenu
				modePrefix={modePrefix}
				tenantId={tenant}
				tenantName={tenantMode === 'sandbox' ? 'tachyon-field-sandbox' : null}
			/>
			<div className='flex flex-col sm:gap-4 sm:py-4 sm:pl-48'>
				<header className='sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6'>
					<SideMenuSheet modePrefix={modePrefix} tenantId={tenant} />
				</header>
				<main className='grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8'>
					<h2>エラーが発生しました</h2>
					{error.message ? (
						<pre className='max-h-40 max-w-full overflow-auto rounded-md border bg-background p-3 text-left text-xs'>
							{error.message}
						</pre>
					) : null}
					{error.digest ? (
						<p className='text-xs text-muted-foreground'>
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
					</div>
				</main>
			</div>
		</div>
	)
}
