import {
	authRedirectUrl,
	authWithCheck,
	clearAuthSessionCookies,
} from 'app/auth'
import { ActionButton } from 'components/action-button'
import { TachyonFieldLogo } from 'components/tachyon-field-logo'
import { TenantPickerClient } from 'components/tenant-picker-client'
import { LogOut } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getCourseboardRootRedirect } from './courseboard-root'

export default async function TenantsList() {
	const courseboardRootRedirect = getCourseboardRootRedirect()
	if (courseboardRootRedirect) {
		redirect(courseboardRootRedirect)
	}

	await authWithCheck()

	return (
		<div className='flex min-h-screen w-full flex-col bg-zinc-50'>
			<header className='flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 sm:px-6'>
				<TachyonFieldLogo markClassName='h-6' />
				<ActionButton
					action={async () => {
						'use server'
						clearAuthSessionCookies()
						redirect(authRedirectUrl('/auth/sign_in'))
					}}
					variant='ghost'
					size='sm'
					className='gap-1.5 text-zinc-500 hover:text-zinc-900'
				>
					<LogOut className='h-4 w-4' />
					ログアウト
				</ActionButton>
			</header>

			<main className='flex flex-1 flex-col items-center px-4 py-8 sm:px-6'>
				<div className='w-full max-w-xl'>
					<h1 className='mb-6 text-lg font-semibold text-zinc-900'>
						テナントを選択
					</h1>

					<TenantPickerClient />

					<p className='mt-4 text-xs text-zinc-400'>
						このアカウントでアクセスできるテナントが表示されます
					</p>
				</div>
			</main>
		</div>
	)
}
