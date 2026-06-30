import {
	type AccountingPaymentReconciliation,
	type AccountingSalesEvent,
	listAccountingCloseReview,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from 'components/ui/breadcrumb'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { Input } from 'components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import {
	fetchInvoiceCandidatesAction,
	fetchSquarePaymentReconciliationsAction,
	reconcileSquarePaymentAction,
	type InvoiceCandidate,
	type SquarePaymentReconciliation,
} from './actions'
import {
	filterReconciliationDrilldownRows,
	type ReconciliationSearchParams,
	resolveReconciliationDrilldownFilter,
} from './drilldown-filter'

export const metadata = {
	title: '売上・支払照合 | TACHYON Field',
	description: '月次締め前の売上イベントと支払照合を確認します。',
}

function formatAmount(value: string, currency = 'JPY') {
	const amount = Number(value)
	if (!Number.isFinite(amount)) return value
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency,
		maximumFractionDigits: currency === 'JPY' ? 0 : 2,
	}).format(amount)
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date(value))
}

function eventLabel(type: string) {
	if (type === 'sale') return '受注'
	if (type === 'refund') return '返金'
	return type
}

function eventStatusLabel(status: string) {
	if (status === 'journalized') return '仕訳済'
	if (status === 'pending') return '未仕訳'
	if (status === 'failed') return '差異確認'
	if (status === 'skipped') return '除外'
	return status
}

function reconciliationStatusLabel(status: string) {
	if (status === 'reconciled') return '照合済'
	if (status === 'pending') return '未照合'
	if (status === 'partial') return '差異あり'
	return status
}

function squareReconciliationStatusLabel(status: string) {
	if (status === 'Unmatched') return '未消込'
	if (status === 'Matched') return '消込済'
	if (status === 'Ignored') return '除外'
	return status
}

function statusVariant(status: string) {
	if (
		status === 'journalized' ||
		status === 'reconciled' ||
		status === 'skipped'
	) {
		return 'secondary' as const
	}
	return 'destructive' as const
}

function invoiceCandidateLabel(invoice: InvoiceCandidate) {
	const customer = invoice.clientName ?? invoice.clientId
	return `${invoice.invoiceNumber} / ${customer} / ${formatAmount(
		String(invoice.totalAmount),
		invoice.currency,
	)}`
}

function SummaryCards({
	salesEvents,
	reconciliations,
}: {
	salesEvents: AccountingSalesEvent[]
	reconciliations: AccountingPaymentReconciliation[]
}) {
	const refundCount = salesEvents.filter(
		item => item.eventType === 'refund',
	).length
	const openJournalCount = salesEvents.filter(item =>
		['pending', 'failed'].includes(item.status),
	).length
	const pendingReconciliationCount = reconciliations.filter(
		item => item.status === 'pending',
	).length
	const differenceCount = reconciliations.filter(
		item => item.status === 'partial',
	).length
	const metrics = [
		{
			label: '売上イベント',
			value: salesEvents.length,
			className: 'text-foreground',
		},
		{ label: '返金', value: refundCount, className: 'text-foreground' },
		{ label: '未仕訳', value: openJournalCount, className: 'text-amber-600' },
		{
			label: '未照合',
			value: pendingReconciliationCount,
			className: 'text-amber-600',
		},
		{
			label: '差異あり',
			value: differenceCount,
			className: 'text-destructive',
		},
	]

	return (
		<div className='grid gap-3 md:grid-cols-5'>
			{metrics.map(metric => (
				<Card key={metric.label}>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm font-medium'>
							{metric.label}
						</CardTitle>
					</CardHeader>
					<CardContent className={`text-2xl font-semibold ${metric.className}`}>
						{metric.value}
					</CardContent>
				</Card>
			))}
		</div>
	)
}

function SquareManualReconciliationTable({
	tenant,
	payments,
	invoices,
}: {
	tenant: string
	payments: SquarePaymentReconciliation[]
	invoices: InvoiceCandidate[]
}) {
	const reconcileAction = reconcileSquarePaymentAction.bind(null, tenant)
	const candidateByAmount = new Map<string, InvoiceCandidate[]>()
	for (const invoice of invoices) {
		const key = `${invoice.currency}:${invoice.totalAmount}`
		candidateByAmount.set(key, [...(candidateByAmount.get(key) ?? []), invoice])
	}

	return (
		<Card>
			<CardHeader>
				<div className='flex items-center justify-between gap-3'>
					<CardTitle>Square 入金消込</CardTitle>
					<Badge variant={payments.length > 0 ? 'destructive' : 'secondary'}>
						未消込 {payments.length} 件
					</Badge>
				</div>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>受信日時</TableHead>
							<TableHead>Square Payment</TableHead>
							<TableHead className='text-right'>入金額</TableHead>
							<TableHead>支払者ヒント</TableHead>
							<TableHead>状態</TableHead>
							<TableHead className='min-w-[360px]'>消込</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{payments.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className='h-20 text-center'>
									Square の未消込入金はありません。
								</TableCell>
							</TableRow>
						) : null}
						{payments.map(payment => {
							const amountMatched = candidateByAmount.get(
								`${payment.currency}:${payment.amount}`,
							)
							const candidates =
								amountMatched && amountMatched.length > 0
									? amountMatched
									: invoices
							return (
								<TableRow key={payment.id}>
									<TableCell>{formatDate(payment.receivedAt)}</TableCell>
									<TableCell>
										<div className='font-mono text-xs'>
											{payment.squarePaymentId}
										</div>
										<div className='text-xs text-muted-foreground'>
											{payment.matchReason ?? payment.id}
										</div>
									</TableCell>
									<TableCell className='text-right'>
										{formatAmount(String(payment.amount), payment.currency)}
									</TableCell>
									<TableCell>{payment.payerHint ?? '-'}</TableCell>
									<TableCell>
										<Badge variant='outline'>
											{squareReconciliationStatusLabel(payment.status)}
										</Badge>
									</TableCell>
									<TableCell>
										<form action={reconcileAction} className='grid gap-2'>
											<input
												type='hidden'
												name='squarePaymentId'
												value={payment.squarePaymentId}
											/>
											<Select name='invoiceId' required>
												<SelectTrigger>
													<SelectValue placeholder='Invoice を選択' />
												</SelectTrigger>
												<SelectContent>
													{candidates.map(invoice => (
														<SelectItem key={invoice.id} value={invoice.id}>
															{invoiceCandidateLabel(invoice)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<div className='flex gap-2'>
												<Input
													name='note'
													placeholder='消込メモ'
													className='h-9'
												/>
												<Button size='sm' type='submit'>
													消込
												</Button>
											</div>
										</form>
									</TableCell>
								</TableRow>
							)
						})}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	)
}

export default async function RevenueReconciliationPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>
	searchParams?: Promise<ReconciliationSearchParams>
}) {
	const { tenant } = await params
	const query = (await searchParams) ?? {}
	const companyId = query.companyId?.trim() ?? ''
	const drilldownFilter = resolveReconciliationDrilldownFilter(query)
	const [reviewResult, squarePaymentsResult, invoiceCandidatesResult] =
		await Promise.all([
			companyId
				? listAccountingCloseReview(tenant, companyId)
						.then(data => ({ data, error: null as string | null }))
						.catch(error => ({
							data: null,
							error:
								error instanceof Error
									? error.message
									: '売上・支払照合データの取得に失敗しました',
						}))
				: Promise.resolve({
						data: null,
						error: 'Company ID を入力してください',
					}),
			fetchSquarePaymentReconciliationsAction(tenant),
			fetchInvoiceCandidatesAction(tenant),
		])
	const review = reviewResult.data
	const sourceId = drilldownFilter.sourceId
	const filtered = review
		? filterReconciliationDrilldownRows(
				review,
				squarePaymentsResult.data ?? [],
				sourceId,
			)
		: { salesEvents: [], reconciliations: [], squarePayments: [] }
	const { salesEvents, reconciliations, squarePayments } = filtered
	const invoiceCandidates = invoiceCandidatesResult.data ?? []

	return (
		<V1Layout
			current='accounting'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>売上・支払照合</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='space-y-2'>
					<div className='flex items-center gap-2'>
						<h1 className='text-2xl font-semibold'>売上・支払照合</h1>
						<Badge variant='outline'>{review ? 'API' : '未取得'}</Badge>
					</div>
					<p className='text-sm text-muted-foreground'>
						受注・支払・返金イベントと照合状態を月次締め前に確認します。
					</p>
				</div>

				<Card>
					<CardContent className='pt-6'>
						<form className='grid gap-3 md:grid-cols-[1fr_auto]'>
							<Input
								name='companyId'
								placeholder='Company ID'
								defaultValue={companyId}
							/>
							<Button type='submit'>確認</Button>
						</form>
					</CardContent>
				</Card>

				{review ? null : (
					<Card>
						<CardContent className='p-8 text-center text-sm text-muted-foreground'>
							{reviewResult.error ??
								'売上・支払照合データを取得できませんでした。'}
						</CardContent>
					</Card>
				)}

				{review ? (
					<>
						<SummaryCards
							salesEvents={salesEvents}
							reconciliations={reconciliations}
						/>

						{sourceId ? (
							<Card>
								<CardContent className='py-3 text-sm'>
									<span className='text-muted-foreground'>
										Drilldown source:{' '}
									</span>
									<span className='font-mono'>
										{drilldownFilter.sourceType
											? `${drilldownFilter.sourceType}:`
											: ''}
										{sourceId}
									</span>
								</CardContent>
							</Card>
						) : null}

						<SquareManualReconciliationTable
							tenant={tenant}
							payments={squarePayments}
							invoices={invoiceCandidates}
						/>

						<Card>
							<CardHeader>
								<CardTitle>売上イベント</CardTitle>
							</CardHeader>
							<CardContent>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>日付</TableHead>
											<TableHead>種別</TableHead>
											<TableHead>Provider</TableHead>
											<TableHead>External ID</TableHead>
											<TableHead className='text-right'>総額</TableHead>
											<TableHead className='text-right'>手数料</TableHead>
											<TableHead>状態</TableHead>
											<TableHead>仕訳</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{salesEvents.map(item => (
											<TableRow key={item.id}>
												<TableCell>{formatDate(item.eventDate)}</TableCell>
												<TableCell>{eventLabel(item.eventType)}</TableCell>
												<TableCell>{item.provider}</TableCell>
												<TableCell className='font-mono text-xs'>
													{item.externalId}
												</TableCell>
												<TableCell className='text-right'>
													{formatAmount(item.grossAmount, item.currency)}
												</TableCell>
												<TableCell className='text-right'>
													{formatAmount(item.feeAmount, item.currency)}
												</TableCell>
												<TableCell>
													<Badge variant={statusVariant(item.status)}>
														{eventStatusLabel(item.status)}
													</Badge>
												</TableCell>
												<TableCell className='font-mono text-xs'>
													{item.journalEntryId ?? '-'}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>未照合・差異あり取引</CardTitle>
							</CardHeader>
							<CardContent>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>入金日</TableHead>
											<TableHead>Provider</TableHead>
											<TableHead>Payout ID</TableHead>
											<TableHead className='text-right'>入金額</TableHead>
											<TableHead>状態</TableHead>
											<TableHead>仕訳</TableHead>
											<TableHead>確認理由</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{reconciliations.map(item => (
											<TableRow key={item.id}>
												<TableCell>{formatDate(item.depositDate)}</TableCell>
												<TableCell>{item.provider}</TableCell>
												<TableCell className='font-mono text-xs'>
													{item.payoutId}
												</TableCell>
												<TableCell className='text-right'>
													{formatAmount(item.depositAmount)}
												</TableCell>
												<TableCell>
													<Badge variant={statusVariant(item.status)}>
														{reconciliationStatusLabel(item.status)}
													</Badge>
												</TableCell>
												<TableCell className='font-mono text-xs'>
													{item.journalEntryId ?? '-'}
												</TableCell>
												<TableCell className='text-sm text-muted-foreground'>
													{item.status === 'partial'
														? '入金額と売掛消込額の差異を確認'
														: item.status === 'pending'
															? '入金明細または売上イベントとの突合待ち'
															: '-'}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					</>
				) : null}
			</MainLayout>
		</V1Layout>
	)
}
