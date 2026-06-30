import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { ToastClient } from 'components/toast-client'
import { PageHeader } from 'components/ui/page-shell'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { ExternalLinkIcon, PlusIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { DataFetchError } from '../orders/data-fetch-error'
import { fetchInvoicesAction, type InvoiceData } from './action'
import {
	invoiceStatusLabels,
	invoiceStatusVariants,
	summarizeInvoices,
} from './view-model'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function InvoicesPage({
	params: { tenant },
	searchParams: { status = 'all' },
}: {
	params: { tenant: string }
	searchParams: { status?: string }
}) {
	const result = await fetchInvoicesAction(tenant, status)
	const invoices = result.data ?? []
	const summary = summarizeInvoices(invoices)

	return (
		<V1Layout current='invoices' tenant={tenant}>
			<MainLayout>
				<PageHeader
					title='請求書'
					description='請求、支払いリンク、入金状態を確認します'
					actions={
						<Button asChild>
							<Link href={`/${tenant}/invoices/new` as Route} prefetch={false}>
								<PlusIcon className='mr-2 size-4' />
								新規作成
							</Link>
						</Button>
					}
				/>
				<section className='space-y-2'>
					<div className='grid grid-cols-2 gap-x-4 gap-y-2 border-y py-3 text-sm sm:grid-cols-4'>
						<SummaryMetric
							label='表示'
							value={`${summary.totalCount} 件`}
							description={yen.format(summary.totalAmount)}
						/>
						<SummaryMetric
							label='未入金'
							value={yen.format(summary.unpaidAmount)}
							description={`${summary.unpaidCount} 件`}
						/>
						<SummaryMetric
							label='期限超過'
							value={`${summary.overdueCount} 件`}
							description='回収フォロー'
						/>
						<SummaryMetric
							label='入金済'
							value={yen.format(summary.paidAmount)}
							description='回収済み'
						/>
					</div>
					<div className='flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between'>
						<div className='flex min-w-0 flex-wrap items-center gap-1'>
							{['all', 'Draft', 'Sent', 'SendFailed', 'Paid', 'Overdue'].map(
								value => (
									<Button
										key={value}
										variant={status === value ? 'default' : 'ghost'}
										size='sm'
										asChild
										className='h-7 px-2.5 text-xs'
									>
										<Link
											href={`/${tenant}/invoices?status=${value}` as Route}
											prefetch={false}
										>
											{value === 'all'
												? 'すべて'
												: invoiceStatusLabels[
														value as keyof typeof invoiceStatusLabels
													]}
										</Link>
									</Button>
								),
							)}
						</div>
						<p className='text-xs text-muted-foreground'>
							表示 {invoices.length.toLocaleString('ja-JP')} 件
						</p>
					</div>
					<div className='overflow-hidden rounded-md border bg-background'>
						{result.success ? (
							<InvoiceList invoices={invoices} tenant={tenant} />
						) : (
							<DataFetchError
								title='請求書一覧を取得できませんでした'
								message={result.message}
								retryHref={`/${tenant}/invoices?status=${status}`}
							/>
						)}
					</div>
				</section>
				{result.success ? null : (
					<ToastClient
						title='請求書一覧を取得できませんでした'
						description={
							result.message ??
							'外部APIまたは連携サービスが一時的に利用できません。再読み込みするか、少し待ってから再試行してください。'
						}
						variant='destructive'
					/>
				)}
			</MainLayout>
		</V1Layout>
	)
}

function InvoiceList({
	invoices,
	tenant,
}: {
	invoices: InvoiceData[]
	tenant: string
}) {
	return (
		<>
			<div className='md:hidden'>
				{invoices.length === 0 ? (
					<div className='py-10 text-center text-sm text-muted-foreground'>
						請求書はありません。
					</div>
				) : null}
				{invoices.map(invoice => (
					<div key={invoice.id} className='border-b p-3 last:border-b-0'>
						<div className='flex items-start justify-between gap-3'>
							<div className='min-w-0'>
								<Link
									className='font-medium hover:underline'
									href={`/${tenant}/invoices/${invoice.id}` as Route}
									prefetch={false}
								>
									{invoice.invoiceNumber}
								</Link>
								<div className='mt-0.5 truncate text-xs text-muted-foreground'>
									{invoice.clientName ?? invoice.clientId}
								</div>
							</div>
							<div className='shrink-0 text-right font-semibold'>
								{yen.format(invoice.totalAmount)}
							</div>
						</div>
						<div className='mt-2 flex flex-wrap items-center gap-1.5'>
							<Badge
								variant={invoiceStatusVariants[invoice.status]}
								className='whitespace-nowrap'
							>
								{invoiceStatusLabels[invoice.status]}
							</Badge>
							<PaymentState invoice={invoice} />
						</div>
						<div className='mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground'>
							<span>支払期限 {formatDate(invoice.dueDate)}</span>
							{invoice.status !== 'Paid' && isPastDue(invoice.dueDate) ? (
								<span className='font-medium text-destructive'>期限超過</span>
							) : null}
						</div>
					</div>
				))}
			</div>
			<div className='hidden md:block'>
				<InvoiceTable invoices={invoices} tenant={tenant} />
			</div>
		</>
	)
}

function InvoiceTable({
	invoices,
	tenant,
}: {
	invoices: InvoiceData[]
	tenant: string
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>請求番号</TableHead>
					<TableHead>取引先</TableHead>
					<TableHead>状態</TableHead>
					<TableHead>支払期限</TableHead>
					<TableHead className='text-right'>合計</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{invoices.length === 0 ? (
					<TableRow>
						<TableCell colSpan={5} className='h-16 text-center'>
							請求書はありません。
						</TableCell>
					</TableRow>
				) : null}
				{invoices.map(invoice => (
					<TableRow key={invoice.id}>
						<TableCell className='py-3'>
							<Link
								className='font-medium hover:underline'
								href={`/${tenant}/invoices/${invoice.id}` as Route}
								prefetch={false}
							>
								{invoice.invoiceNumber}
							</Link>
							<div className='text-xs text-muted-foreground'>{invoice.id}</div>
						</TableCell>
						<TableCell>{invoice.clientName ?? invoice.clientId}</TableCell>
						<TableCell>
							<div className='flex flex-wrap items-center gap-1.5'>
								<Badge
									variant={invoiceStatusVariants[invoice.status]}
									className='whitespace-nowrap'
								>
									{invoiceStatusLabels[invoice.status]}
								</Badge>
								<PaymentState invoice={invoice} />
							</div>
						</TableCell>
						<TableCell>
							<div>{formatDate(invoice.dueDate)}</div>
							{invoice.status !== 'Paid' && isPastDue(invoice.dueDate) ? (
								<div className='text-xs font-medium text-destructive'>
									期限超過
								</div>
							) : null}
						</TableCell>
						<TableCell className='text-right'>
							{yen.format(invoice.totalAmount)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}

function SummaryMetric({
	label,
	value,
	description,
}: {
	label: string
	value: string
	description: string
}) {
	return (
		<div className='min-w-0'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='truncate text-base font-semibold'>{value}</div>
			<div className='truncate text-xs text-muted-foreground'>
				{description}
			</div>
		</div>
	)
}

function PaymentState({
	invoice,
}: {
	invoice: InvoiceData
}) {
	if (invoice.status === 'Paid') {
		return <Badge className='whitespace-nowrap'>入金済</Badge>
	}
	if (invoice.paymentLinkUrl) {
		return (
			<div className='flex flex-wrap items-center gap-1.5'>
				<Badge variant='outline' className='whitespace-nowrap'>
					リンクあり
				</Badge>
				<Link
					className='flex items-center gap-1 whitespace-nowrap text-xs text-blue-700 hover:underline'
					href={invoice.paymentLinkUrl as Route}
					prefetch={false}
					target='_blank'
				>
					公開ページ
					<ExternalLinkIcon className='size-3' />
				</Link>
			</div>
		)
	}
	return (
		<Badge variant='secondary' className='whitespace-nowrap'>
			リンク未発行
		</Badge>
	)
}

function formatDate(value?: string | null) {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date)
}

function formatDateTime(value?: string | null) {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat('ja-JP', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

function isPastDue(value: string) {
	const dueDate = new Date(`${value}T23:59:59`)
	if (Number.isNaN(dueDate.getTime())) return false
	return dueDate.getTime() < Date.now()
}
