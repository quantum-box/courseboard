import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon, PowerIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { enableExtensionAction, fetchExtensionStatusesAction } from '../../action'
import {
	createExtensionApplicationKioskReservationAction,
	fetchExtensionApplicationConfigAction,
	fetchReservationResourcesAction,
	fetchReservationTypesAction,
} from '../../../reservations/action'
import { ApplicationKioskForm } from './ApplicationKioskForm'

export const metadata = {
	title: 'iPad受付 | TACHYON Field',
	description: 'Member and application intake kiosk.',
}

export default async function ExtensionApplicationKioskPage({
	params: { tenant, appName },
}: {
	params: { tenant: string; appName: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const extensionKey = normalizeExtensionKey(appName)
	const [typesResult, resourcesResult, configResult, statusesResult] =
		await Promise.all([
			fetchReservationTypesAction(tenant),
			fetchReservationResourcesAction(tenant),
			fetchExtensionApplicationConfigAction(tenant, extensionKey),
			fetchExtensionStatusesAction(tenant),
		])
	const reservationType = typesResult.success
		? typesResult.data.find(type => type.code === extensionKey)
		: null
	const extensionStatus = statusesResult.success
		? statusesResult.data.find(status => status.extensionKey === extensionKey)
		: null
	const enabled =
		extensionStatus?.tenantStatus === 'enabled' && Boolean(reservationType)
	const resources = resourcesResult.success
		? resourcesResult.data.filter(resource =>
				new RegExp(`${extensionKey}|generic`, 'i').test(
					`${resource.resourceModel} ${resource.resourceType}`,
				),
			)
		: []
	const config = configResult.data
	const presentation = config.formPresentation

	return (
		<V1Layout current='extensions' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
					<div>
						<h1 className='text-2xl font-semibold'>
							{presentation.kioskTitle}
						</h1>
						<p className='mt-1 max-w-3xl text-sm text-muted-foreground'>
							{presentation.kioskDescription}
						</p>
					</div>
					<Button asChild variant='outline'>
						<Link href={`${prefix}/${tenant}/extensions` as Route}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							予約設定へ戻る
						</Link>
					</Button>
				</div>

				{!enabled ? (
					<div className='flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							<p className='font-semibold'>{presentation.disabledTitle}</p>
							<p className='mt-1'>{presentation.disabledDescription}</p>
						</div>
						<form action={enableExtensionAction.bind(null, tenant, extensionKey)}>
							<Button type='submit'>
								<PowerIcon className='mr-2 h-4 w-4' />
								有効化
							</Button>
						</form>
					</div>
				) : null}

				<ApplicationKioskForm
					action={createExtensionApplicationKioskReservationAction.bind(
						null,
						tenant,
						extensionKey,
					)}
					config={config}
					disabled={!enabled}
					resources={resources}
				/>
			</MainLayout>
		</V1Layout>
	)
}

function normalizeExtensionKey(value: string) {
	return /^[a-z0-9_-]+$/.test(value) ? value : 'application'
}
