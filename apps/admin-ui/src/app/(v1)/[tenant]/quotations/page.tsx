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
import { fetchQuotationsAction, type QuotationData } from './action'
import { DataFetchError } from '../orders/data-fetch-error'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const statusLabels: Record<string, string> = {
	Draft: '下書き',
	Sent: '送付済',
	Accepted: '承認済',
	Rejected: '却下',
	Expired: '期限切れ',
}

export default async function QuotationsPage({
	params: { tenant },
	searchParams: { status = 'all' },
}: {
	params: { tenant: string }
	searchParams: { status?: string }
}) {
	const result = await fetchQuotationsAction(tenant, status)
	const quotations = result.data ?? []

	return (
		<V1Layout current='quotations' tenant={tenant}>
			<MainLayout>
				<PageHeader
					title='見積書'
					description='取引先別の見積状況と有効期限を確認します'
					actions={
						<Button asChild>
							<Link href={`/${tenant}/quotations/new` as Route}>新規作成</Link>
						</Button>
					}
				/>
				<section className='space-y-2'>
					<div className='flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between'>
						<div className='flex min-w-0 flex-wrap items-center gap-1'>
							{['all', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'].map(
								value => (
									<Button
										key={value}
										variant={status === value ? 'default' : 'ghost'}
										size='sm'
										asChild
										className='h-7 px-2.5 text-xs'
									>
										<Link
											href={`/${tenant}/quotations?status=${value}` as Route}
										>
											{value === 'all' ? 'すべて' : statusLabels[value]}
										</Link>
									</Button>
								),
							)}
						</div>
						<p className='text-xs text-muted-foreground'>
							表示 {quotations.length.toLocaleString('ja-JP')} 件
						</p>
					</div>
					<div className='overflow-hidden rounded-md border bg-background'>
						{result.success ? (
							<QuotationTable quotations={quotations} tenant={tenant} />
						) : (
							<DataFetchError
								title='見積書一覧を取得できませんでした'
								message={result.message}
								retryHref={`/${tenant}/quotations?status=${status}`}
							/>
						)}
					</div>
				</section>
				{result.success ? null : (
					<ToastClient
						title='見積書一覧を取得できませんでした'
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

function QuotationTable({
	quotations,
	tenant,
}: {
	quotations: QuotationData[]
	tenant: string
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>見積番号</TableHead>
					<TableHead>取引先</TableHead>
					<TableHead>ステータス</TableHead>
					<TableHead>有効期限</TableHead>
					<TableHead className='text-right'>合計</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{quotations.length === 0 ? (
					<TableRow>
						<TableCell colSpan={5} className='h-16 text-center'>
							見積書はありません。
						</TableCell>
					</TableRow>
				) : null}
				{quotations.map(quotation => (
					<TableRow key={quotation.id}>
						<TableCell>
							<Link
								className='font-medium hover:underline'
								href={`/${tenant}/quotations/${quotation.id}` as Route}
							>
								{quotation.quotationNumber}
							</Link>
							<div className='text-xs text-muted-foreground'>
								{quotation.id}
							</div>
						</TableCell>
						<TableCell>{quotation.clientName ?? quotation.clientId}</TableCell>
						<TableCell>
							<Badge variant='outline'>
								{statusLabels[quotation.status] ?? quotation.status}
							</Badge>
						</TableCell>
						<TableCell>{quotation.validUntil}</TableCell>
						<TableCell className='text-right'>
							{yen.format(quotation.totalAmount)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}
