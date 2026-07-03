import { TachyonFieldLogo } from 'components/tachyon-field-logo'
import { SignInButton } from './sign-in-button'

type SignInSearchParams = {
	error?: string | string[]
}

function includesSearchParam(
	value: string | string[] | undefined,
	expected: string,
) {
	return Array.isArray(value) ? value.includes(expected) : value === expected
}

export default async function SignInPage({
	searchParams,
}: {
	searchParams?: SignInSearchParams | Promise<SignInSearchParams>
} = {}) {
	const resolvedSearchParams = searchParams ? await searchParams : undefined
	const isExpiredSession = includesSearchParam(
		resolvedSearchParams?.error,
		'expired',
	)

	return (
		<div className='flex min-h-screen w-full flex-col bg-white lg:flex-row'>
			<div className='flex min-h-[180px] w-full shrink-0 flex-col justify-between bg-zinc-900 p-6 lg:min-h-screen lg:flex-1 lg:p-10'>
				<div className='inline-flex items-center gap-2'>
					<TachyonFieldLogo tone='dark' markClassName='h-8' />
				</div>
				<div className='flex flex-col items-start justify-start gap-2 self-stretch'>
					<div className='self-stretch text-base font-normal leading-7 text-white sm:text-lg'>
						“このサービスを利用することでちょうどいいデジタル化を実施できます”
					</div>
					<div className='text-sm font-normal leading-tight text-white'>
						Quantum Box, Inc.
					</div>
				</div>
			</div>
			<div className='flex w-full flex-1 flex-col items-center justify-center gap-6 px-5 py-10 lg:px-10'>
				<div className='flex flex-col items-center justify-center py-2 text-center'>
					<div className='text-2xl font-semibold leading-loose text-zinc-950'>
						ログイン
					</div>
					<div className='text-sm font-normal leading-tight text-zinc-500'>
						ログインしてサービスを始める
					</div>
				</div>
				{isExpiredSession && (
					<div
						aria-live='polite'
						className='w-full max-w-[350px] rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-left'
						role='status'
					>
						<div className='text-sm font-medium leading-5 text-zinc-950'>
							セッションが失効しました
						</div>
						<div className='mt-1 text-xs leading-5 text-zinc-500'>
							安全のためログアウトしました。もう一度ログインしてください。
						</div>
					</div>
				)}
				<div className='flex w-full max-w-[350px] flex-col gap-3'>
					<SignInButton />
				</div>
				<div className='max-w-[350px] text-center'>
					<span className='text-sm font-normal leading-tight text-zinc-500'>
						続行をクリックすることで
					</span>
					<span className='text-sm font-normal leading-tight text-blue-400 underline'>
						利用規約
					</span>
					<span className='text-sm font-normal leading-tight text-zinc-500'>
						および
					</span>
					<span className='text-sm font-normal leading-tight text-blue-400 underline'>
						プライバシーポリシー
					</span>
					<span className='text-sm font-normal leading-tight text-zinc-500'>
						に同意したものとみなされます。
					</span>
				</div>
			</div>
		</div>
	)
}
