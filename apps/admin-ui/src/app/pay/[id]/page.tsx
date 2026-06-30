import { authWithCheck } from 'app/auth'
import { TachyonFieldLogo } from 'components/tachyon-field-logo'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { ArrowLeftIcon, LockIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminPayGuardPage({
	params: { id },
}: {
	params: { id: string }
}) {
	await authWithCheck()

	return (
		<main className='flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10'>
			<Card className='w-full max-w-xl'>
				<CardHeader className='space-y-4'>
					<TachyonFieldLogo markClassName='h-7' />
					<div className='flex items-start gap-3'>
						<div className='rounded-md border bg-background p-2'>
							<LockIcon className='size-5 text-muted-foreground' />
						</div>
						<div className='space-y-1'>
							<CardTitle className='text-xl'>
								管理画面では公開支払いページを表示しません
							</CardTitle>
							<CardDescription>
								このURLはTACHYON Field admin上の保護された確認ページです。
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className='space-y-4 text-sm'>
					<div className='rounded-md border bg-muted/40 p-3'>
						<div className='text-xs text-muted-foreground'>請求書ID</div>
						<div className='mt-1 break-all font-mono text-sm'>{id}</div>
					</div>
					<p className='text-muted-foreground'>
						顧客向けの公開支払いページは、TACHYON Field の公開UI側で発行されたURLを使用してください。
						adminの請求書詳細にある支払いリンクから確認できます。
					</p>
				</CardContent>
				<CardFooter className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
					<Button asChild variant='outline' className='w-full sm:w-auto'>
						<Link href={'/' as Route}>
							<ArrowLeftIcon className='mr-2 size-4' />
							テナント選択へ戻る
						</Link>
					</Button>
				</CardFooter>
			</Card>
		</main>
	)
}
