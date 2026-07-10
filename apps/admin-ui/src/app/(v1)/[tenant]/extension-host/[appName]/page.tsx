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
import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { ExtensionHostFrame } from '../_components/extension-host-frame'
import {
	ExtensionRegistryUnavailableError,
	ExtensionSurfaceUnavailableError,
	resolveCloudAppExtensionHost,
} from '../_lib/resolve-cloud-app-extension'

export const metadata = {
	title: 'Cloud App Extension Host | TACHYON Field',
	description: 'Host Cloud App extension UI inside TACHYON Field admin.',
}

export default async function ExtensionHostPage({
	params: { tenant, appName },
}: {
	params: { tenant: string; appName: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const extensionsHref = `${prefix}/${tenant}/extensions` as Route

	try {
		const host = await resolveCloudAppExtensionHost(tenant, appName, 'ui')

		return (
			<V1Layout
				current='extensions'
				tenant={tenant}
				breadcrumbs={
					<ExtensionHostBreadcrumbs
						tenant={tenant}
						prefix={prefix}
						label={host.extension.label}
					/>
				}
			>
				<MainLayout>
					<div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'>
						<div className='min-w-0 space-y-1'>
							<h1 className='text-2xl font-semibold'>{host.extension.label}</h1>
							<p className='max-w-3xl text-sm text-muted-foreground'>
								{host.extension.appName} Cloud App extension
							</p>
						</div>
						<div className='grid min-w-0 gap-2 sm:grid-cols-2 lg:flex lg:justify-end'>
							<Button asChild variant='outline' className='w-full lg:w-auto'>
								<Link href={extensionsHref}>
									<ArrowLeftIcon className='mr-2 h-4 w-4' />
									一覧へ戻る
								</Link>
							</Button>
							{host.extension.ui.kioskUrl ? (
								<Button asChild variant='outline' className='w-full lg:w-auto'>
									<Link
										href={
											`${prefix}/${tenant}/extension-host/${appName}/kiosk` as Route
										}
									>
										<ExternalLinkIcon className='mr-2 h-4 w-4' />
										受付を開く
									</Link>
								</Button>
							) : null}
						</div>
					</div>

					<ExtensionHostFrame
						src={host.iframeUrl}
						title={host.extension.label}
					/>
				</MainLayout>
			</V1Layout>
		)
	} catch (error) {
		if (error instanceof ExtensionRegistryUnavailableError) {
			return (
				<ExtensionHostErrorLayout
					tenant={tenant}
					prefix={prefix}
					title='Extension registry unavailable'
					description={error.message}
				/>
			)
		}
		if (error instanceof ExtensionSurfaceUnavailableError) {
			return (
				<ExtensionHostErrorLayout
					tenant={tenant}
					prefix={prefix}
					title='Extension surface unavailable'
					description={error.message}
				/>
			)
		}
		throw error
	}
}

function ExtensionHostErrorLayout({
	tenant,
	prefix,
	title,
	description,
}: {
	tenant: string
	prefix: string
	title: string
	description: string
}) {
	return (
		<V1Layout current='extensions' tenant={tenant}>
			<MainLayout>
				<Card className='border-destructive/40'>
					<CardHeader>
						<CardTitle>{title}</CardTitle>
						<CardDescription>{description}</CardDescription>
					</CardHeader>
				</Card>
				<Button asChild variant='outline' className='mt-4 w-fit'>
					<Link href={`${prefix}/${tenant}/extensions` as Route}>
						<ArrowLeftIcon className='mr-2 h-4 w-4' />
						一覧へ戻る
					</Link>
				</Button>
			</MainLayout>
		</V1Layout>
	)
}

function ExtensionHostBreadcrumbs({
	tenant,
	prefix,
	label,
}: {
	tenant: string
	prefix: string
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
					<BreadcrumbPage>{label}</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	)
}
