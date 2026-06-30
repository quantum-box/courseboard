import { Button } from 'components/ui/button'
import { ExternalLink } from 'lucide-react'
import React from 'react'

export function SignInButton() {
	return (
		<div className='grid w-full gap-3'>
			<form action='/api/auth/signin/cognito' className='w-full' method='get'>
				<input name='identity_provider' type='hidden' value='Google' />
				<Button className='w-full gap-2' type='submit' variant='outline'>
					<span className='text-base font-semibold leading-none'>G</span>
					Google でログイン
				</Button>
			</form>
			<form action='/api/auth/signin/cognito' className='w-full' method='get'>
				<Button className='w-full gap-2' type='submit' variant='outline'>
					<ExternalLink className='h-4 w-4' />
					Cognito Hosted UI でログイン
				</Button>
			</form>
		</div>
	)
}
