import { DataStateMessage } from 'components/ui/page-shell'
import React from 'react'

export function DataFetchError({
	title,
	message,
	retryHref,
}: {
	title: string
	message?: string
	retryHref: string
}) {
	return (
		<DataStateMessage
			title={title}
			description={
				message ??
				'外部APIまたは連携サービスが一時的に利用できません。少し待ってから再試行してください。'
			}
			retryHref={retryHref}
			variant='destructive'
		/>
	)
}
