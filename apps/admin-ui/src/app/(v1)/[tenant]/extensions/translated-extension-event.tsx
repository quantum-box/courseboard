'use client'

import { useAdminI18n } from 'lib/admin-i18n'

export function TranslatedExtensionEvent({
	extensionKey,
	eventType,
	statusAfter,
	actorId,
}: {
	extensionKey: string
	eventType: string
	statusAfter: string
	actorId?: string | null
}) {
	const { t } = useAdminI18n()
	const extensionLabel =
		extensionKey === 'golf_course' ? t('extensions.productSettings') : extensionKey
	const eventLabel =
		eventType === 'enable'
			? t('extensions.enable')
			: eventType === 'disable'
				? t('extensions.disable')
				: eventType
	const statusLabel =
		statusAfter === 'enabled'
			? t('common.enabled')
			: statusAfter === 'disabled'
				? t('common.disabled')
				: statusAfter

	return (
		<>
			<div className='font-medium'>
				{extensionLabel} {eventLabel}
			</div>
			<div className='text-muted-foreground md:col-span-2'>
				{t('extensions.status')}: {statusLabel}
				{actorId ? ` / ${t('extensions.actor')}: ${actorId}` : ''}
			</div>
		</>
	)
}
