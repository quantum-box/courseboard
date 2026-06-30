'use client'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { type ClientDetailOnClientFieldFragment } from 'gen/graphql'
import { getServerModePrefix } from 'lib/mode'
import { ProviderName } from 'lib/product-constants'
import {
	BriefcaseBusinessIcon,
	CalendarCheckIcon,
	ChevronLeftIcon,
	FileSearchIcon,
	FileTextIcon,
	HistoryIcon,
	RefreshCwIcon,
	ReceiptTextIcon,
	ShoppingCartIcon,
	type LucideIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import React from 'react'
import { useForm } from 'react-hook-form'
import type {
	Customer360Data,
	Customer360Kind,
	Customer360TimelineItem,
} from '../customer-360-format'

const timelineIcons: Record<Customer360Kind, LucideIcon> = {
	deal: BriefcaseBusinessIcon,
	quotation: FileTextIcon,
	order: ShoppingCartIcon,
	consumerOrder: ShoppingCartIcon,
	reservation: CalendarCheckIcon,
	invoice: ReceiptTextIcon,
	cancellationFee: ReceiptTextIcon,
	arAp: ReceiptTextIcon,
	evidence: FileSearchIcon,
	auditReference: HistoryIcon,
}

function formatDate(value?: string | null) {
	if (!value) {
		return '日付未設定'
	}
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value
	}
	return new Intl.DateTimeFormat('ja-JP', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(date)
}

function TimelineRow({
	item,
	tenantId,
}: {
	item: Customer360TimelineItem
	tenantId: string
}) {
	const Icon = timelineIcons[item.kind]
	const href = customer360Href(tenantId, item.path)

	return (
		<Link
			href={href}
			className='grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-md border border-zinc-200 bg-white px-3 py-3 transition-colors hover:bg-zinc-50'
		>
			<div className='mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 text-zinc-700'>
				<Icon className='h-4 w-4' />
			</div>
			<div className='min-w-0'>
				<div className='flex flex-wrap items-center gap-2'>
					<p className='truncate text-sm font-medium text-zinc-900'>
						{item.title}
					</p>
					{item.status ? (
						<Badge variant='secondary' className='shrink-0'>
							{item.status}
						</Badge>
					) : null}
				</div>
				{item.description ? (
					<p className='mt-1 truncate text-xs text-zinc-500'>
						{item.description}
					</p>
				) : null}
				<p className='mt-1 text-xs text-zinc-400'>{formatDate(item.date)}</p>
			</div>
			{item.amount ? (
				<div className='text-right text-sm font-semibold text-zinc-900'>
					{item.amount}
				</div>
			) : null}
		</Link>
	)
}

function customer360Href(tenantId: string, path: string) {
	const normalizedPath = path.startsWith('/') ? path : `/${path}`
	return `${getServerModePrefix(tenantId)}/${tenantId}${normalizedPath}` as Route
}

function itemTime(item: Customer360TimelineItem) {
	if (!item.date) return 0
	const time = new Date(item.date).getTime()
	return Number.isNaN(time) ? 0 : time
}

export function Customer360Hub({
	data,
	error,
	tenantId,
	retryHref,
}: {
	data?: Customer360Data
	error?: string
	tenantId: string
	retryHref: Route
}) {
	const sections = data?.sections ?? []
	const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0)
	const latestItems = sections
		.flatMap(section => section.items)
		.sort((a, b) => itemTime(b) - itemTime(a))
		.slice(0, 12)

	return (
		<Card>
			<CardHeader>
				<div className='flex flex-wrap items-start justify-between gap-2'>
					<div>
						<CardTitle>Customer 360</CardTitle>
						<CardDescription>
							商談・受注・予約・請求・証憑を取引先単位で集約します。
						</CardDescription>
					</div>
					<Badge variant='outline'>{totalItems} 件</Badge>
				</div>
			</CardHeader>
			<CardContent>
				{error ? (
					<div className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
						<span>{error}</span>
						<Button size='sm' variant='outline' asChild>
							<Link href={retryHref}>
								<RefreshCwIcon className='mr-2 h-3.5 w-3.5' />
								再試行
							</Link>
						</Button>
					</div>
				) : null}
				<div className='grid gap-4'>
					<section className='grid gap-2'>
						<div className='flex items-center justify-between gap-2'>
							<h2 className='text-sm font-semibold text-zinc-900'>
								最新アクティビティ
							</h2>
							<span className='text-xs text-zinc-500'>
								{latestItems.length} 件
							</span>
						</div>
						{latestItems.length > 0 ? (
							<div className='grid gap-2'>
								{latestItems.map(item => (
									<TimelineRow
										key={`latest-${item.kind}-${item.id}`}
										item={item}
										tenantId={tenantId}
									/>
								))}
							</div>
						) : (
							<div className='rounded-md border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500'>
								顧客に紐づくアクティビティはまだありません。
							</div>
						)}
					</section>
					{sections.map(section => (
						<section key={section.key} className='grid gap-2'>
							<div className='flex items-center justify-between gap-2'>
								<h2 className='text-sm font-semibold text-zinc-900'>
									{section.title}
								</h2>
								<span className='text-xs text-zinc-500'>
									{section.items.length} 件
								</span>
							</div>
							{section.error ? (
								<div className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'>
									<span>
										{section.title}の取得に失敗しました: {section.error}
									</span>
									<Button size='sm' variant='outline' asChild>
										<Link href={retryHref}>
											<RefreshCwIcon className='mr-2 h-3.5 w-3.5' />
											再試行
										</Link>
									</Button>
								</div>
							) : section.items.length > 0 ? (
								<div className='grid gap-2'>
									{section.items.map(item => (
										<TimelineRow
											key={`${section.key}-${item.id}`}
											item={item}
											tenantId={tenantId}
										/>
									))}
								</div>
							) : (
								<div className='rounded-md border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500'>
									関連する{section.title}は未接続です。
								</div>
							)}
						</section>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

export function ClientDetail({
	data,
	backLink,
	tenantId,
	customer360,
	customer360Error,
}: {
	data?: ClientDetailOnClientFieldFragment
	backLink: Route
	tenantId: string
	customer360?: Customer360Data
	customer360Error?: string
}) {
	const { register } = useForm<ClientDetailOnClientFieldFragment>({
		defaultValues: data,
	})
	const quotationSearch = new URLSearchParams({
		clientId: data?.id ?? '',
		clientName: data?.name ?? '',
	})
	if (data?.email) quotationSearch.set('clientEmail', data.email)
	const quotationHref =
		`${getServerModePrefix(tenantId)}/${tenantId}/quotations/new?${quotationSearch.toString()}` as Route
	const invoiceSearch = new URLSearchParams({
		clientId: data?.id ?? '',
		clientName: data?.name ?? '',
	})
	if (data?.email) invoiceSearch.set('clientEmail', data.email)
	const invoiceHref =
		`${getServerModePrefix(tenantId)}/${tenantId}/invoices/new?${invoiceSearch.toString()}` as Route

	return (
		<main className='grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8'>
			<form className='mx-auto grid max-w-[59rem] flex-1 auto-rows-max gap-4'>
				<div className='flex items-center gap-4'>
					<Button className='h-7 w-7' size='icon' variant='outline' asChild>
						<Link href={backLink}>
							<ChevronLeftIcon className='h-4 w-4' />
							<span className='sr-only'>戻る</span>
						</Link>
					</Button>
					<h1 className='flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0'>
						{data?.name}
					</h1>

					<div className='hidden items-center gap-2 md:ml-auto md:flex'>
						<Button size='sm' variant='outline' asChild>
							<Link
								href={
									`${getServerModePrefix(tenantId)}/${tenantId}/deals/new?clientId=${data?.id ?? ''}&clientName=${encodeURIComponent(data?.name ?? '')}` as Route
								}
							>
								新規案件
							</Link>
						</Button>
						<Button size='sm' variant='outline' asChild>
							<Link href={quotationHref}>見積作成</Link>
						</Button>
						<Button size='sm' variant='outline' asChild>
							<Link href={invoiceHref}>請求書作成</Link>
						</Button>
						<Button size='sm' variant='outline'>
							変更を破棄
						</Button>
						<Button size='sm' type='submit'>
							取引先を保存する
						</Button>
					</div>
				</div>
				<div className='grid gap-4 md:grid-cols-[2fr_1fr] lg:gap-8'>
					<div className='grid auto-rows-max items-start gap-4 lg:gap-8'>
						<Customer360Hub
							data={customer360}
							error={customer360Error}
							tenantId={tenantId}
							retryHref={
								`${getServerModePrefix(tenantId)}/${tenantId}/library/clients/${data?.id ?? ''}` as Route
							}
						/>
						<Card>
							<CardHeader>
								<CardTitle>取引先詳細</CardTitle>
								<CardDescription>
									このセクションでは、取引先の詳細情報を提供します。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className='grid gap-6'>
									<div className='grid gap-3'>
										<Label htmlFor='name'>取引先名</Label>
										<Input
											className='w-full'
											id='name'
											placeholder='取引先名をここに入力する'
											{...register('name')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='corporationNumber'>法人番号</Label>
										<Input
											className='w-full'
											id='corporationNumber'
											placeholder='法人番号をここに入力する'
											{...register('corporationNumber')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='headOfficeAddress'>本社住所</Label>
										<Input
											className='w-full'
											id='headOfficeAddress'
											placeholder='本社住所をここに入力する'
											{...register('headOfficeAddress')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='representative'>代表者</Label>
										<Input
											className='w-full'
											id='representative'
											placeholder='代表者をここに入力する'
											{...register('representative')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='capital'>資本金</Label>
										<Input
											className='w-full'
											id='capital'
											placeholder='資本金をここに入力する'
											{...register('capital')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='industry'>業種</Label>
										<Input
											className='w-full'
											id='industry'
											placeholder='業種をここに入力する'
											{...register('industry')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='listed'>上場or非上場</Label>
										<Input
											className='w-full'
											id='listed'
											placeholder='上場or非上場をここに入力する'
											{...register('listed')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='founded'>会社設立年月日</Label>
										<Input
											className='w-full'
											id='founded'
											placeholder='会社設立年月日をここに入力する'
											{...register('founded')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='email'>メールアドレス</Label>
										<Input
											className='w-full'
											id='email'
											placeholder='メールアドレスをここに入力する'
											{...register('email')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='phoneNumber'>電話番号</Label>
										<Input
											className='w-full'
											id='phoneNumber'
											placeholder='電話番号をここに入力する'
											{...register('phoneNumber')}
										/>
									</div>
									<div className='grid gap-3'>
										<Label htmlFor='faxNumber'>FAX番号</Label>
										<Input
											className='w-full'
											id='faxNumber'
											placeholder='FAX番号をここに入力する'
											{...register('faxNumber')}
										/>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>
					<div className='grid auto-rows-max items-start gap-4 lg:gap-8'>
						<Card>
							<CardHeader>
								<CardTitle>プロバイダ</CardTitle>
							</CardHeader>
							<CardContent>
								<div className='grid gap-6'>
									{data?.providers.map(provider => (
										<div
											key={provider.providerPrimaryId}
											className='flex items-center justify-between p-4 border rounded-lg shadow-sm'
										>
											<div>
												<p className='text-sm font-medium text-gray-900'>
													{provider.providerName}
												</p>
												<p className='text-sm text-gray-500'>
													{provider.providerPrimaryId}
												</p>
											</div>
											{provider.providerName === ProviderName.HubSpot && (
												<Link
													href={`https://app.hubspot.com/contacts/${provider.providerTenantId}/record/0-2/${provider.providerPrimaryId}`}
													target='_blank'
													rel='noopener noreferrer'
													className='text-blue-600 hover:underline text-sm'
												>
													HubSpotで開く
												</Link>
											)}
											{provider.providerName === ProviderName.Salesforce && (
												<Link
													href={`https://login.salesforce.com/${provider.providerTenantId}/record/${provider.providerPrimaryId}`}
													target='_blank'
													rel='noopener noreferrer'
													className='text-blue-600 hover:underline'
												>
													Salesforceで開く
												</Link>
											)}
										</div>
									))}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>取引先をアーカイブ</CardTitle>
								<CardDescription>
									この取引先をアーカイブします。アーカイブされた取引先は表示されません。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Button size='sm' variant='secondary'>
									取引先をアーカイブ
								</Button>
							</CardContent>
						</Card>
					</div>
				</div>
			</form>
		</main>
	)
}
