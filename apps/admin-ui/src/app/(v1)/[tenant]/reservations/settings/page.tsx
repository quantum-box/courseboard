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
import { MainLayout, V1Layout } from 'components/v1-layout'
import { ArrowLeftIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import {
	fetchReservationNotificationSettingsAction,
	fetchReservationResourcesAction,
	fetchReservationTypesAction,
	saveReservationNotificationSettingsAction,
	type ReservationResourceData,
	type ReservationTypeData,
} from '../action'
import { ReservationNotificationSettingsPanel } from '../reservation-notification-settings'

export const metadata = {
	title: '予約設定 | TACHYON Field',
	description: '予約通知、リソース、予約タイプを管理します。',
}

export default async function ReservationSettingsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const [notificationSettingsResult, resourcesResult, typesResult] =
		await Promise.all([
			fetchReservationNotificationSettingsAction(tenant),
			fetchReservationResourcesAction(tenant),
			fetchReservationTypesAction(tenant),
		])
	const resources = resourcesResult.success ? resourcesResult.data : []
	const types = typesResult.success ? typesResult.data : []

	return (
		<V1Layout
			current='reservations'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`/${tenant}/reservations` as Route}>予約管理</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>予約設定</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='grid gap-4'>
					<div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'>
						<div className='min-w-0'>
							<h1 className='text-2xl font-semibold'>予約設定</h1>
							<p className='mt-1 text-sm text-muted-foreground'>
								通知テンプレート、予約タイプ、リソースを運用画面から分けて管理します。
							</p>
						</div>
						<Button asChild variant='outline'>
							<Link href={`/${tenant}/reservations` as Route}>
								<ArrowLeftIcon className='mr-2 h-4 w-4' />
								予約一覧へ
							</Link>
						</Button>
					</div>

					<section className='grid gap-4'>
						<div>
							<h2 className='text-base font-semibold'>通知テンプレート</h2>
							<p className='mt-1 text-sm text-muted-foreground'>
								予約確認、リマインダー、変更・キャンセル連絡の文面と自動送信を管理します。
							</p>
						</div>
						{notificationSettingsResult.success ? (
							<ReservationNotificationSettingsPanel
								action={async (_state, formData) => {
									'use server'
									return saveReservationNotificationSettingsAction(
										tenant,
										formData,
									)
								}}
								settings={notificationSettingsResult.data}
							/>
						) : (
							<p className='text-sm text-destructive'>
								{notificationSettingsResult.message ??
									'通知設定を取得できませんでした'}
							</p>
						)}
					</section>

					<div className='grid gap-4 lg:grid-cols-2'>
						<ReservationMasterList
							emptyLabel='リソースは未登録です。'
							errorMessage={
								resourcesResult.success ? undefined : resourcesResult.message
							}
							items={resources.map(resource => ({
								id: resource.id,
								name: resource.name,
								meta: resourceSummary(resource),
							}))}
							title='リソース'
						/>
						<ReservationMasterList
							emptyLabel='予約タイプは未登録です。'
							errorMessage={
								typesResult.success ? undefined : typesResult.message
							}
							items={types.map(type => ({
								id: type.id,
								name: type.name,
								meta: typeSummary(type),
							}))}
							title='予約タイプ'
						/>
					</div>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

function ReservationMasterList({
	emptyLabel,
	errorMessage,
	items,
	title,
}: {
	emptyLabel: string
	errorMessage?: string
	items: { id: string; meta: string; name: string }[]
	title: string
}) {
	return (
		<section className='grid gap-3'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h2 className='text-base font-semibold'>{title}</h2>
					<p className='mt-1 text-sm text-muted-foreground'>
						予約作成と受付フォームで参照されるマスタです。
					</p>
				</div>
				<Badge variant='secondary'>{items.length}件</Badge>
			</div>
			{errorMessage ? (
				<p className='text-sm text-destructive'>{errorMessage}</p>
			) : null}
			<div className='overflow-hidden rounded-lg border bg-background'>
				{items.length === 0 && !errorMessage ? (
					<p className='p-4 text-sm text-muted-foreground'>{emptyLabel}</p>
				) : null}
				{items.map(item => (
					<div key={item.id} className='border-b px-4 py-3 last:border-b-0'>
						<p className='font-medium'>{item.name}</p>
						<p className='mt-1 break-all text-xs text-muted-foreground'>
							{item.meta}
						</p>
					</div>
				))}
			</div>
		</section>
	)
}

function resourceSummary(resource: ReservationResourceData) {
	return `${resource.resourceType} / ${resource.resourceModel} / ${resource.capacity}枠`
}

function typeSummary(type: ReservationTypeData) {
	return `${type.code} / ${type.resourceModel}`
}
