import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { ExtensionHostFrame } from '../../_components/extension-host-frame'
import {
	ExtensionRegistryUnavailableError,
	ExtensionSurfaceUnavailableError,
	resolveCloudAppExtensionHost,
} from '../../_lib/resolve-cloud-app-extension'

export const metadata = {
	title: 'Cloud App Kiosk Host | TACHYON Field',
	description: 'Host Cloud App kiosk UI inside TACHYON Field admin.',
}

export default async function ExtensionHostKioskPage({
	params: { tenant, appName },
}: {
	params: { tenant: string; appName: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const hostHref = `${prefix}/${tenant}/extension-host/${appName}` as Route

	try {
		const host = await resolveCloudAppExtensionHost(tenant, appName, 'kiosk')

		return (
			<V1Layout
				current='extensions'
				tenant={tenant}
				breadcrumbs={
					<ExtensionHostKioskBreadcrumbs
						tenant={tenant}
						prefix={prefix}
						appName={appName}
						label={host.extension.label}
					/>
				}
			>
				<MainLayout>
					<div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'>
						<div className='min-w-0 space-y-1'>
							<h1 className='text-2xl font-semibold'>
								{host.extension.label} 受付
							</h1>
							<p className='max-w-3xl text-sm text-muted-foreground'>
								Cloud App kiosk surface hosted in TACHYON Field admin.
							</p>
						</div>
						<Button asChild variant='outline' className='w-full lg:w-auto'>
							<Link href={hostHref}>
								<ArrowLeftIcon className='mr-2 h-4 w-4' />
								拡張 UI へ戻る
							</Link>
						</Button>
					</div>

					<ExtensionHostFrame
						src={host.iframeUrl}
						title={`${host.extension.label} 受付`}
					/>
				</MainLayout>
			</V1Layout>
		)
	} catch (error) {
		if (
			error instanceof ExtensionRegistryUnavailableError ||
			error instanceof ExtensionSurfaceUnavailableError
		) {
			return (
				<V1Layout current='extensions' tenant={tenant}>
					<MainLayout>
						<Card className='border-destructive/40'>
							<CardHeader>
								<CardTitle>Kiosk surface unavailable</CardTitle>
								<CardDescription>{error.message}</CardDescription>
							</CardHeader>
						</Card>
					</MainLayout>
				</V1Layout>
			)
		}
		throw error
	}
}

function ExtensionHostKioskBreadcrumbs({
	tenant,
	prefix,
	appName,
	label,
}: {
	tenant: string
	prefix: string
	appName: string
	label: string
}) {
	return (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink asChild>
						<Link href={`${prefix}/${tenant}/home` as Route}>ホーム</Link>
					</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbLink asChild>
						<Link href={`${prefix}/${tenant}/extensions` as Route}>アプリ</Link>
					</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbLink asChild>
						<Link
							href={`${prefix}/${tenant}/extension-host/${appName}` as Route}
						>
							{label}
						</Link>
					</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbPage>受付</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	)
}
