import { Badge } from 'components/ui/badge'
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { T } from 'lib/admin-i18n'
import { fetchCloudAppExtensions } from 'lib/cloud-app-extensions'
import { getExtensionAdminSurface } from 'lib/extension-admin-registry'
import { getServerModePrefix } from 'lib/mode'
import {
	CalendarCheckIcon,
	ExternalLinkIcon,
	PackagePlusIcon,
	SettingsIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import {
	type ExtensionStatusData,
	disableExtensionAction,
	enableExtensionAction,
	fetchExtensionStatusesAction,
} from './action'

export const metadata = {
	title: 'アプリ | TACHYON Field',
	description: 'Apps installed on TACHYON Field OS.',
}

export default async function ExtensionsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const statusesResult = await fetchExtensionStatusesAction(tenant)
	const cloudAppsResult = await fetchCloudAppExtensions(tenant)
	const statuses = statusesResult.success ? statusesResult.data : []

	return (
		<V1Layout
			current='extensions'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/home` as Route}>ホーム</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>アプリ</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'>
					<div className='min-w-0 space-y-1'>
						<h1 className='text-2xl font-semibold'>
							<T k='extensions.title' />
						</h1>
						<p className='max-w-3xl text-sm text-muted-foreground'>
							<T k='extensions.description' />
						</p>
					</div>
					<div className='grid min-w-0 gap-2 sm:grid-cols-3 lg:flex lg:justify-end'>
						<Button
							asChild
							className='min-w-0 w-full sm:whitespace-nowrap lg:w-auto'
						>
							<Link href={`${prefix}/${tenant}/library/products/new` as Route}>
								<PackagePlusIcon className='mr-2 h-4 w-4' />
								予約商品を追加
							</Link>
						</Button>
						<Button
							asChild
							variant='outline'
							className='min-w-0 w-full sm:whitespace-nowrap lg:w-auto'
						>
							<Link href={`${prefix}/${tenant}/reservations` as Route}>
								<CalendarCheckIcon className='mr-2 h-4 w-4' />
								<T k='extensions.reservations' />
							</Link>
						</Button>
						<Button
							asChild
							variant='outline'
							className='min-w-0 w-full sm:whitespace-nowrap lg:w-auto'
						>
							<Link href={`${prefix}/${tenant}/settings` as Route}>
								<SettingsIcon className='mr-2 h-4 w-4' />
								<T k='extensions.tenantSettings' />
							</Link>
						</Button>
					</div>
				</div>

				{!statusesResult.success && (
					<Card className='border-destructive/40'>
						<CardHeader>
							<CardTitle className='text-base'>
								<T k='extensions.statusLoadError' />
							</CardTitle>
							<CardDescription>{statusesResult.message}</CardDescription>
						</CardHeader>
					</Card>
				)}

				<ExtensionStatusTable
					extensions={statuses}
					prefix={prefix}
					tenant={tenant}
				/>

				<CloudAppExtensionsTable
					result={cloudAppsResult}
					prefix={prefix}
					tenant={tenant}
				/>
			</MainLayout>
		</V1Layout>
	)
}

function ExtensionStatusTable({
	extensions,
	prefix,
	tenant,
}: {
	extensions: ExtensionStatusData[]
	prefix: string
	tenant: string
}) {
	if (extensions.length === 0) {
		return (
			<div className='rounded-md border bg-background p-4 text-sm text-muted-foreground'>
				有効化できるアプリはありません。
			</div>
		)
	}

	return (
		<div className='min-w-0 overflow-hidden rounded-md border bg-background'>
			<Table className='min-w-[760px]'>
				<TableHeader>
					<TableRow>
						<TableHead>アプリ</TableHead>
						<TableHead>種別</TableHead>
						<TableHead>状態</TableHead>
						<TableHead>設定</TableHead>
						<TableHead>検証</TableHead>
						<TableHead>更新</TableHead>
						<TableHead className='text-right'>操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{extensions.map(extension => {
						const enabled = extension.tenantStatus === 'enabled'
						const adminSurface = getExtensionAdminSurface(
							extension.extensionKey,
						)
						const managementHref = adminSurface
							? (`${prefix}/${tenant}${adminSurface.managementPath}` as Route)
							: (`${prefix}/${tenant}/extensions/${extension.extensionKey}` as Route)
						const managementLabel = adminSurface
							? adminSurface.managementLabel
							: '設定を編集'
						const toggleAction = (
							enabled ? disableExtensionAction : enableExtensionAction
						).bind(null, tenant, extension.extensionKey)

						return (
							<TableRow key={extension.extensionKey}>
								<TableCell>
									<div className='font-medium'>{extension.name}</div>
									<div className='text-xs text-muted-foreground'>
										{extension.extensionKey} / v{extension.version}
									</div>
								</TableCell>
								<TableCell className='text-muted-foreground'>
									{extension.industry}
								</TableCell>
								<TableCell>
									<Badge variant={enabled ? 'default' : 'secondary'}>
										{enabled ? '有効' : '無効'}
									</Badge>
								</TableCell>
								<TableCell>
									{extension.configVersion ? (
										<span>v{extension.configVersion}</span>
									) : (
										<span className='text-muted-foreground'>default</span>
									)}
								</TableCell>
								<TableCell>
									<span
										className={
											extension.validation.valid ? '' : 'text-destructive'
										}
									>
										{extension.validation.valid ? 'OK' : '要確認'}
									</span>
									{extension.validation.valid ? null : (
										<div className='mt-1 max-w-xs text-xs text-destructive'>
											{extension.validation.errors[0]}
										</div>
									)}
								</TableCell>
								<TableCell className='text-muted-foreground'>
									{formatDateTime(extension.updatedAt)}
								</TableCell>
								<TableCell>
									<div className='flex justify-end gap-2'>
										<Button asChild size='sm' variant='outline'>
											<Link href={managementHref}>{managementLabel}</Link>
										</Button>
										<form action={toggleAction}>
											<Button
												type='submit'
												size='sm'
												variant={enabled ? 'outline' : 'default'}
											>
												{enabled ? '無効化' : '有効化'}
											</Button>
										</form>
									</div>
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}

function CloudAppExtensionsTable({
	result,
	prefix,
	tenant,
}: {
	result: Awaited<ReturnType<typeof fetchCloudAppExtensions>>
	prefix: string
	tenant: string
}) {
	if (!result.ok || result.extensions.length === 0) {
		return null
	}

	return (
		<div className='space-y-2'>
			<div>
				<h2 className='text-base font-semibold'>外部アプリ</h2>
				<p className='text-sm text-muted-foreground'>
					TACHYON Field OS に接続されている Cloud App です。
				</p>
			</div>
			<div className='rounded-md border bg-background'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Cloud App</TableHead>
							<TableHead>App name</TableHead>
							<TableHead className='text-right'>操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{result.extensions.map(extension => (
							<TableRow key={extension.appName}>
								<TableCell className='font-medium'>{extension.label}</TableCell>
								<TableCell className='text-muted-foreground'>
									{extension.appName}
								</TableCell>
								<TableCell>
									<div className='flex justify-end gap-2'>
										<Button asChild variant='outline' size='sm'>
											<Link
												href={
													`${prefix}/${tenant}/extension-host/${extension.appName}` as Route
												}
											>
												<ExternalLinkIcon className='mr-2 h-4 w-4' />
												Open
											</Link>
										</Button>
										{extension.ui.kioskUrl ? (
											<Button asChild variant='outline' size='sm'>
												<Link
													href={
														`${prefix}/${tenant}/extension-host/${extension.appName}/kiosk` as Route
													}
												>
													<ExternalLinkIcon className='mr-2 h-4 w-4' />
													受付
												</Link>
											</Button>
										) : null}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

function formatDateTime(value?: string | null) {
	if (!value) return '-'
	return new Intl.DateTimeFormat('ja-JP', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(value))
}
