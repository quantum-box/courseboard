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
import type { Route } from 'next'
import Link from 'next/link'
import { fetchInvoicesAction } from './action'
import { DataFetchError } from '../orders/data-fetch-error'
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
							<Link href={`/${tenant}/cancellation-fees/new` as Route} prefetch={false}>
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
		<div className='rounded-md border bg-card p-3'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='mt-1 text-lg font-semibold'>{value}</div>
			<div className='text-xs text-muted-foreground'>{description}</div>
		</div>
	)
}

function InvoiceList({
	invoices,
	tenant,
}: {
	invoices: Awaited<ReturnType<typeof fetchInvoicesAction>>['data']
	tenant: string
}) {
	const list = invoices ?? []
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
				{list.length === 0 ? (
					<TableRow>
						<TableCell colSpan={5} className='h-16 text-center'>
							請求書はありません。
						</TableCell>
					</TableRow>
				) : null}
				{list.map(invoice => (
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
							<Badge
								variant={invoiceStatusVariants[invoice.status]}
								className='whitespace-nowrap'
							>
								{invoiceStatusLabels[invoice.status]}
							</Badge>
						</TableCell>
						<TableCell>{invoice.dueDate.slice(0, 10)}</TableCell>
						<TableCell className='text-right'>
							{yen.format(invoice.totalAmount)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}
