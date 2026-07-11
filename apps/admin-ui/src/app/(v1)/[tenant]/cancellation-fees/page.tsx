import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { PageHeader } from 'components/ui/page-shell'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import type { Route } from 'next'
import Link from 'next/link'
import {
	invoiceStatusLabels,
	invoiceStatusVariants,
} from '../invoices/view-model'
import { fetchCancellationFeeInvoicesAction } from './action'
import { summarizeCancellationFees } from './view-model'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function CancellationFeesPage({
	params: { tenant },
	searchParams: { status = 'all' },
}: {
	params: { tenant: string }
	searchParams: { status?: string }
}) {
	const result = await fetchCancellationFeeInvoicesAction(tenant, status)
	const invoices = result.data ?? []
	const summary = summarizeCancellationFees(invoices)

	return (
		<V1Layout current='cancellation-fees' tenant={tenant}>
			<MainLayout>
				<PageHeader
					title='キャンセル料'
					description='キャンセル料請求の作成と、請求書の状態を確認します'
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
						<SummaryMetric label='表示' value={`${summary.totalCount} 件`} />
						<SummaryMetric
							label='未入金'
							value={yen.format(summary.unpaidAmount)}
						/>
						<SummaryMetric
							label='期限超過'
							value={`${summary.overdueCount} 件`}
						/>
						<SummaryMetric label='入金済' value={yen.format(summary.paidAmount)} />
					</div>
					<div className='flex flex-wrap gap-1.5'>
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
										href={`/${tenant}/cancellation-fees?status=${value}` as Route}
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
					<div className='overflow-hidden rounded-md border bg-background'>
						<CancellationFeeTable invoices={invoices} tenant={tenant} />
					</div>
				</section>
			</MainLayout>
		</V1Layout>
	)
}

function SummaryMetric({
	label,
	value,
}: {
	label: string
	value: string
}) {
	return (
		<div className='rounded-md border bg-card p-3'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='mt-1 text-lg font-semibold'>{value}</div>
		</div>
	)
}

function CancellationFeeTable({
	invoices,
	tenant,
}: {
	invoices: Awaited<ReturnType<typeof fetchCancellationFeeInvoicesAction>>['data']
	tenant: string
}) {
	const list = invoices ?? []
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>請求番号</TableHead>
					<TableHead>請求先</TableHead>
					<TableHead>状態</TableHead>
					<TableHead>支払期限</TableHead>
					<TableHead className='text-right'>請求額</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{list.length === 0 ? (
					<TableRow>
						<TableCell colSpan={5} className='h-16 text-center'>
							キャンセル料請求はありません。
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
