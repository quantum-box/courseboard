import { Button } from 'components/ui/button'
import { useAdminI18n } from 'lib/admin-i18n'
import { Loader2Icon, RefreshCwIcon } from 'lucide-react'
import React from 'react'

export function ExternalServiceFetchError({
	loadError,
	loading,
	onRefresh,
}: {
	loadError?: string
	loading: boolean
	onRefresh?: () => void
}) {
	const { t } = useAdminI18n()

	return (
		<div className='rounded-lg border border-destructive/30 bg-destructive/5 p-4'>
			<p className='text-sm font-medium text-destructive'>
				{t('external.fetchFailed')}
			</p>
			<p className='mt-1 text-sm text-muted-foreground'>
				{loadError ?? t('external.fetchTemporary')}
			</p>
			<Button
				variant='outline'
				size='sm'
				onClick={onRefresh}
				disabled={loading}
				className='mt-3'
			>
				{loading ? (
					<Loader2Icon className='h-4 w-4 animate-spin mr-2' />
				) : (
					<RefreshCwIcon className='h-4 w-4 mr-2' />
				)}
				{t('external.reload')}
			</Button>
		</div>
	)
}
