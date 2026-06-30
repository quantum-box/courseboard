'use client'

import { Button } from 'components/ui/button'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { getModeFromOperatorId, getPlatformIdForMode } from 'lib/mode'
import { Loader2, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
	tenant: string
	accessToken: string
}

type Period = 'weekly' | 'monthly'

export function ReportActions({ tenant, accessToken }: Props) {
	const router = useRouter()
	const [generating, setGenerating] = useState<Period | null>(null)
	const [message, setMessage] = useState<string | null>(null)

	const generate = async (period: Period) => {
		setGenerating(period)
		setMessage(null)
		try {
			const response = await fetch(
				`${getBrowserBackendBaseUrl()}/v1/field/agent/reports/generate`,
				{
					method: 'POST',
					headers: {
						...buildHeaders(tenant, accessToken),
						'content-type': 'application/json',
					},
					body: JSON.stringify({ period }),
				},
			)
			if (!response.ok) {
				const body = await response.text().catch(() => '')
				throw new Error(
					body || `自動レポートの生成に失敗しました (${response.status})`,
				)
			}
			setMessage('レポートを生成しました。')
			router.refresh()
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: '自動レポートの生成に失敗しました。',
			)
		} finally {
			setGenerating(null)
		}
	}

	return (
		<div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
			<div className='flex flex-wrap gap-2'>
				<Button
					size='sm'
					onClick={() => generate('weekly')}
					disabled={generating !== null}
				>
					{generating === 'weekly' ? (
						<Loader2 className='mr-2 h-4 w-4 animate-spin' aria-hidden='true' />
					) : (
						<RefreshCw className='mr-2 h-4 w-4' aria-hidden='true' />
					)}
					週次レポート生成
				</Button>
				<Button
					size='sm'
					variant='outline'
					onClick={() => generate('monthly')}
					disabled={generating !== null}
				>
					{generating === 'monthly' ? (
						<Loader2 className='mr-2 h-4 w-4 animate-spin' aria-hidden='true' />
					) : (
						<RefreshCw className='mr-2 h-4 w-4' aria-hidden='true' />
					)}
					月次レポート生成
				</Button>
			</div>
			{message ? (
				<p className='text-sm text-muted-foreground' role='status'>
					{message}
				</p>
			) : null}
		</div>
	)
}

function getBrowserBackendBaseUrl() {
	return getBackendBaseUrl().replace('http://0.0.0.0', 'http://localhost')
}

function buildHeaders(
	tenant: string,
	accessToken: string,
): Record<string, string> {
	const mode = getModeFromOperatorId(tenant)
	return {
		Authorization: `Bearer ${accessToken}`,
		'x-operator-id': tenant,
		'x-platform-id': getPlatformIdForMode(mode),
	}
}
