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
import {
	fetchCloudAppExtensions,
	findCloudAppExtension,
} from 'lib/cloud-app-extensions'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon, ExternalLinkIcon, InfoIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
	disableExtensionAction,
	enableExtensionAction,
	fetchExtensionStatusesAction,
	updateExtensionConfigAction,
} from '../action'
import { ExtensionStatusCard } from '../extension-status-card'

export const metadata = {
	title: 'Cloud App Extension | TACHYON Field',
	description: 'Cloud App extension host.',
}

export default async function CloudAppExtensionPage({
	params: { tenant, appName },
}: {
	params: { tenant: string; appName: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const extensionKey = normalizeExtensionKey(appName)
	const statusesResult = await fetchExtensionStatusesAction(tenant)
	const managedExtension = statusesResult.success
		? statusesResult.data.find(status => status.extensionKey === extensionKey)
		: null
	const extensionsHref = `${prefix}/${tenant}/extensions` as Route
	if (managedExtension) {
		return (
			<V1Layout
				current='extensions'
				tenant={tenant}
				breadcrumbs={
					<ExtensionBreadcrumbs
						tenant={tenant}
						prefix={prefix}
						label={managedExtension.name}
					/>
				}
			>
				<MainLayout>
					<div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'>
						<div className='min-w-0 space-y-1'>
							<h1 className='text-2xl font-semibold'>
								{managedExtension.name}
							</h1>
							<p className='max-w-3xl text-sm text-muted-foreground'>
								一覧では状態だけを確認し、詳細画面で設定を編集します。
							</p>
						</div>
						<div className='grid min-w-0 gap-2 sm:grid-cols-2 lg:flex lg:justify-end'>
							<Button asChild variant='outline' className='w-full lg:w-auto'>
								<Link href={extensionsHref}>
									<ArrowLeftIcon className='mr-2 h-4 w-4' />
									一覧へ戻る
								</Link>
							</Button>
							{extensionKey === 'dog_run' ? (
								<Button asChild variant='outline' className='w-full lg:w-auto'>
									<Link
										href={
											`${prefix}/${tenant}/extensions/dog_run/kiosk` as Route
										}
									>
										<ExternalLinkIcon className='mr-2 h-4 w-4' />
										受付を開く
									</Link>
								</Button>
							) : null}
						</div>
					</div>

					{hasApplicationIntakeConfig(managedExtension.configJson) ? (
						<ApplicationIntakeArchitectureNote />
					) : null}

					<ExtensionStatusCard
						extension={managedExtension}
						updateConfigAction={updateExtensionConfigAction.bind(
							null,
							tenant,
							managedExtension.extensionKey,
						)}
						toggleAction={(managedExtension.tenantStatus === 'enabled'
							? disableExtensionAction
							: enableExtensionAction
						).bind(null, tenant, managedExtension.extensionKey)}
					/>
				</MainLayout>
			</V1Layout>
		)
	}

	const result = await fetchCloudAppExtensions(tenant)

	if (!result.ok) {
		return (
			<V1Layout
				current='extensions'
				tenant={tenant}
				breadcrumbs={
					<ExtensionBreadcrumbs
						tenant={tenant}
						prefix={prefix}
						label='Extension registry'
					/>
				}
			>
				<MainLayout>
					<Card className='border-destructive/40'>
						<CardHeader>
							<CardTitle>Extension registry unavailable</CardTitle>
							<CardDescription>{result.message}</CardDescription>
						</CardHeader>
					</Card>
				</MainLayout>
			</V1Layout>
		)
	}

	const extension = findCloudAppExtension(result.extensions, appName)
	if (!extension) {
		notFound()
	}

	redirect(`${prefix}/${tenant}/extension-host/${appName}` as Route)
}

function normalizeExtensionKey(value: string) {
	return /^[a-z0-9_-]+$/.test(value) ? value : 'application'
}

function ApplicationIntakeArchitectureNote() {
	return (
		<section className='min-w-0 rounded-md border bg-muted/30 p-4'>
			<div className='flex items-start gap-3'>
				<InfoIcon className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
				<div className='min-w-0 space-y-2'>
					<div>
						<h2 className='text-sm font-semibold'>この設定画面の作られ方</h2>
						<p className='mt-1 max-w-4xl text-sm leading-6 text-muted-foreground'>
							この画面はアプリ専用 React
							ではなく、アプリ設定が持つ文言、料金、対象、同意項目と
							configEditorSpec を Field OS の許可済み部品で描画しています。
						</p>
					</div>
					<div className='grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4'>
						<p>
							<span className='font-medium text-foreground'>文言・料金</span>
							<br />
							formPresentation / courses
						</p>
						<p>
							<span className='font-medium text-foreground'>対象・同意</span>
							<br />
							subjectGroups / consentItems
						</p>
						<p>
							<span className='font-medium text-foreground'>編集 UI</span>
							<br />
							configEditorSpec + safe registry
						</p>
						<p>
							<span className='font-medium text-foreground'>保存先</span>
							<br />
							tenant app config
						</p>
					</div>
				</div>
			</div>
		</section>
	)
}

function hasApplicationIntakeConfig(config?: Record<string, unknown> | null) {
	return Boolean(
		config &&
			typeof config.formPresentation === 'object' &&
			!Array.isArray(config.formPresentation) &&
			Array.isArray(config.courses) &&
			Array.isArray(config.consentItems) &&
			Array.isArray(config.subjectGroups),
	)
}

function ExtensionBreadcrumbs({
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
