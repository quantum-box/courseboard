import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
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
import { getServerModePrefix } from 'lib/mode'
import { DownloadIcon, ExternalLinkIcon, ReceiptTextIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import {
	type CancellationFeeReportItem,
	fetchCancellationFeeReportAction,
} from './action'

export const metadata = {
	title: 'キャンセル料レポート | TACHYON Field',
	description: '予約キャンセル料の請求、リンク発行、支払状況を確認します',
}

function todayYmd() {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function monthStartYmd() {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function validYmd(value: unknown) {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
		? value
		: undefined
}

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function CancellationFeeReportPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>
	searchParams: Promise<{ from?: string; to?: string }>
}) {
	const { tenant } = await params
	const sp = await searchParams
	const from = validYmd(sp.from) ?? monthStartYmd()
	const to = validYmd(sp.to) ?? todayYmd()
	const prefix = getServerModePrefix(tenant)
	const result = await fetchCancellationFeeReportAction(tenant, from, to)
	const items = result.success ? result.data : []
	const summary = summarize(items)
	const csvParams = new URLSearchParams({ tenant, from, to })

	return (
		<V1Layout
			current='erp-reports'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/reports` as Route}>
									レポート
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>キャンセル料</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='キャンセル料レポート'
					description='キャンセル料の未請求、請求リンク発行済み、支払済みを確認します'
					actions={
						<div className='flex flex-wrap gap-2'>
							<Button variant='outline' size='sm' asChild>
								<Link
									href={
										`/api/reservation-reports/reservations.csv?${csvParams.toString()}` as Route
									}
								>
									<DownloadIcon className='mr-2 h-4 w-4' aria-hidden='true' />
									予約CSV
								</Link>
							</Button>
							<Button size='sm' asChild>
								<Link
									href={
										`/api/reservation-reports/cancellation-fees.csv?${csvParams.toString()}` as Route
									}
								>
									<DownloadIcon className='mr-2 h-4 w-4' aria-hidden='true' />
									キャンセル料CSV
								</Link>
							</Button>
						</div>
					}
				/>

				<form className='mb-4 flex flex-wrap items-end gap-3'>
					<label className='grid gap-1 text-sm'>
						<span className='font-medium text-muted-foreground'>From</span>
						<input
							type='date'
							name='from'
							defaultValue={from}
							className='h-9 rounded-md border px-3 text-sm'
						/>
					</label>
					<label className='grid gap-1 text-sm'>
						<span className='font-medium text-muted-foreground'>To</span>
						<input
							type='date'
							name='to'
							defaultValue={to}
							className='h-9 rounded-md border px-3 text-sm'
						/>
					</label>
					<Button type='submit' variant='outline' size='sm'>
						期間を更新
					</Button>
				</form>

				{result.success ? null : (
					<div className='mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>
						{result.message}
					</div>
				)}

				<div className='mb-4 grid gap-3 md:grid-cols-4'>
					<SummaryCard title='未請求' value={summary.unissued} />
					<SummaryCard title='リンク発行済み' value={summary.linkCreated} />
					<SummaryCard title='支払済み' value={summary.paid} />
					<SummaryCard title='請求金額' value={yen.format(summary.totalFee)} />
				</div>

				<Card>
					<CardHeader>
						<CardTitle className='flex items-center gap-2 text-base'>
							<ReceiptTextIcon className='h-5 w-5 text-muted-foreground' />
							キャンセル料一覧
						</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>予約番号</TableHead>
									<TableHead>顧客</TableHead>
									<TableHead>状態</TableHead>
									<TableHead className='text-right'>請求額</TableHead>
									<TableHead className='text-right'>支払済み</TableHead>
									<TableHead>リンク</TableHead>
									<TableHead>取消日時</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{items.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={7}
											className='py-8 text-center text-sm text-muted-foreground'
										>
											対象期間のキャンセル料はありません。
										</TableCell>
									</TableRow>
								) : (
									items.map(item => (
										<TableRow key={`${item.reservationId}-${item.createdAt}`}>
											<TableCell className='font-medium'>
												{item.reservationNumber}
											</TableCell>
											<TableCell>
												<div>{item.customerName ?? '未設定'}</div>
												<div className='text-xs text-muted-foreground'>
													{item.customerEmail ?? ''}
												</div>
											</TableCell>
											<TableCell>
												<FeeStatusBadge item={item} />
											</TableCell>
											<TableCell className='text-right'>
												{formatMoney(item.cancellationFeeAmount, item.currency)}
											</TableCell>
											<TableCell className='text-right'>
												{formatMoney(item.paidAmount, item.currency)}
											</TableCell>
											<TableCell>
												{item.checkoutUrl ? (
													<Button variant='outline' size='sm' asChild>
														<a
															href={item.checkoutUrl}
															target='_blank'
															rel='noreferrer'
														>
															<ExternalLinkIcon
																className='mr-2 h-4 w-4'
																aria-hidden='true'
															/>
															開く
														</a>
													</Button>
												) : (
													<span className='text-sm text-muted-foreground'>
														未発行
													</span>
												)}
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												{item.cancelledAt
													? new Date(item.cancelledAt).toLocaleString('ja-JP')
													: '-'}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}

function SummaryCard({
	title,
	value,
}: { title: string; value: string | number }) {
	return (
		<Card>
			<CardContent className='p-4'>
				<div className='text-sm text-muted-foreground'>{title}</div>
				<div className='mt-1 text-2xl font-semibold'>{value}</div>
			</CardContent>
		</Card>
	)
}

function FeeStatusBadge({ item }: { item: CancellationFeeReportItem }) {
	if (item.paymentStatus === 'fee_paid' || item.paidAmount > 0) {
		return <Badge>支払済み</Badge>
	}
	if (item.checkoutUrl) {
		return <Badge variant='secondary'>リンク発行済み</Badge>
	}
	if (item.cancellationFeeAmount <= 0) {
		return <Badge variant='outline'>免除</Badge>
	}
	return <Badge variant='destructive'>未請求</Badge>
}

function summarize(items: CancellationFeeReportItem[]) {
	return items.reduce(
		(acc, item) => {
			acc.totalFee += item.cancellationFeeAmount
			if (item.paymentStatus === 'fee_paid' || item.paidAmount > 0) {
				acc.paid += 1
			} else if (item.checkoutUrl) {
				acc.linkCreated += 1
			} else {
				acc.unissued += 1
			}
			return acc
		},
		{ unissued: 0, linkCreated: 0, paid: 0, totalFee: 0 },
	)
}

function formatMoney(amount: number, currency: string) {
	if (currency === 'JPY') return yen.format(amount)
	return `${amount.toLocaleString()} ${currency}`
}
