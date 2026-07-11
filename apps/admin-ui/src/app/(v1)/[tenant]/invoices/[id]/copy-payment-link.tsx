'use client'

import { Button } from 'components/ui/button'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'

export function CopyPaymentLink({ url }: { url: string }) {
	const [copied, setCopied] = useState(false)
	const [copyFailed, setCopyFailed] = useState(false)

	async function copy() {
		setCopyFailed(false)
		const success = await copyText(url)
		if (!success) {
			setCopyFailed(true)
			return
		}
		setCopied(true)
		window.setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className='space-y-2'>
			<Button type='button' variant='outline' className='w-full' onClick={copy}>
				{copied ? (
					<CheckIcon className='mr-2 h-4 w-4' />
				) : (
					<CopyIcon className='mr-2 h-4 w-4' />
				)}
				{copied ? 'コピーしました' : '支払いURLをコピー'}
			</Button>
			{copyFailed ? (
				<p className='text-xs text-muted-foreground'>
					ブラウザの権限で自動コピーできませんでした。上のURLを選択してコピーしてください。
				</p>
			) : null}
		</div>
	)
}

async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		return fallbackCopyText(text)
	}
}

function fallbackCopyText(text: string) {
	const textarea = document.createElement('textarea')
	textarea.value = text
	textarea.setAttribute('readonly', '')
	textarea.style.position = 'fixed'
	textarea.style.top = '-9999px'
	document.body.appendChild(textarea)
	textarea.select()
	try {
		return document.execCommand('copy')
	} catch {
		return false
	} finally {
		document.body.removeChild(textarea)
	}
}
