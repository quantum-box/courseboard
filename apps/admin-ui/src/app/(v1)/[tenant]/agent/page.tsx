import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
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
	BotIcon,
	ExternalLinkIcon,
	FileTextIcon,
	MailIcon,
	ReceiptTextIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type { InvoiceData } from '../invoices/action'
import type { QuotationData } from '../quotations/action'
import {
	fetchAgentInvoicesAction,
	fetchAgentQuotationsAction,
	sendAgentInvoiceAction,
	sendAgentQuotationAction,
} from './action'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const quotationStatusLabels: Record<string, string> = {
	Draft: '下書き',
	Sent: '送付済',
	Accepted: '承認済',
	Rejected: '却下',
	Expired: '期限切れ',
}

const invoiceStatusLabels: Record<string, string> = {
	Draft: '下書き',
	Sent: '送付済',
	Paid: '入金済',
	Overdue: '期限超過',
}

export default async function AgentDocumentsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const [quotationResult, invoiceResult] = await Promise.all([
		fetchAgentQuotationsAction(tenant),
		fetchAgentInvoicesAction(tenant),
	])
	const quotations = quotationResult.data ?? []
	const invoices = invoiceResult.data ?? []
	const draftCount =
		quotations.filter(item => item.status === 'Draft').length +
		invoices.filter(item => item.status === 'Draft').length
	const totalAmount =
		quotations.reduce((sum, item) => sum + item.totalAmount, 0) +
		invoices.reduce((sum, item) => sum + item.totalAmount, 0)

	return (
		<V1Layout current='agent' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
					<div>
						<h1 className='flex items-center gap-2 text-2xl font-semibold'>
							<BotIcon className='size-6' />
							書類 Agent
						</h1>
						<p className='text-sm text-muted-foreground'>
							Agent 経由で作成された見積書・請求書のレビューと送付
						</p>
					</div>
					<div className='flex flex-wrap gap-2'>
						<Button asChild variant='outline'>
							<Link href={`/${tenant}/quotations/new` as Route}>
								<FileTextIcon className='mr-2 size-4' />
								見積作成
							</Link>
						</Button>
						<Button asChild>
							<Link href={`/${tenant}/invoices/new` as Route}>
								<ReceiptTextIcon className='mr-2 size-4' />
								請求作成
							</Link>
						</Button>
					</div>
				</div>

				<div className='grid gap-3 md:grid-cols-3'>
					<SummaryTile label='レビュー待ち' value={`${draftCount} 件`} />
					<SummaryTile
						label='直近の書類'
						value={`${quotations.length + invoices.length} 件`}
					/>
					<SummaryTile label='表示合計' value={yen.format(totalAmount)} />
				</div>

				{quotationResult.success && invoiceResult.success ? null : (
					<Card className='border-destructive/40 bg-destructive/5'>
						<CardContent className='p-4 text-sm text-destructive'>
							{quotationResult.message ?? invoiceResult.message}
						</CardContent>
					</Card>
				)}

				<div className='grid gap-4 xl:grid-cols-2'>
					<DocumentPanel
						title='見積書'
						empty='見積書はありません。'
						rows={quotations.map(item => ({
							id: item.id,
							number: item.quotationNumber,
							client: item.clientName ?? item.clientId,
							status: quotationStatusLabels[item.status] ?? item.status,
							dateLabel: '有効期限',
							date: item.validUntil,
							totalAmount: item.totalAmount,
							href: `/${tenant}/quotations/${item.id}` as Route,
							pdfHref: `/${tenant}/quotations/${item.id}/pdf` as Route,
							sendAction: sendAgentQuotationAction.bind(null, tenant, item.id),
							canSend: item.status !== 'Sent',
						}))}
					/>
					<DocumentPanel
						title='請求書'
						empty='請求書はありません。'
						rows={invoices.map(item => ({
							id: item.id,
							number: item.invoiceNumber,
							client: item.clientName ?? item.clientId,
							status: invoiceStatusLabels[item.status] ?? item.status,
							dateLabel: '支払期限',
							date: item.dueDate,
							totalAmount: item.totalAmount,
							href: `/${tenant}/invoices/${item.id}` as Route,
							pdfHref: `/${tenant}/invoices/${item.id}/pdf` as Route,
							sendAction: sendAgentInvoiceAction.bind(null, tenant, item.id),
							canSend: item.status !== 'Sent' && item.status !== 'Paid',
						}))}
					/>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

function SummaryTile({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardContent className='p-4'>
				<div className='text-sm text-muted-foreground'>{label}</div>
				<div className='mt-1 text-xl font-semibold'>{value}</div>
			</CardContent>
		</Card>
	)
}

type DocumentRow = {
	id: string
	number: string
	client: string
	status: string
	dateLabel: string
	date: string
	totalAmount: number
	href: Route
	pdfHref: Route
	sendAction: () => Promise<void>
	canSend: boolean
}

function DocumentPanel({
	title,
	empty,
	rows,
}: {
	title: string
	empty: string
	rows: DocumentRow[]
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>番号</TableHead>
							<TableHead>取引先</TableHead>
							<TableHead>状態</TableHead>
							<TableHead>期日</TableHead>
							<TableHead className='text-right'>合計</TableHead>
							<TableHead className='w-36 text-right'>操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className='h-24 text-center'>
									{empty}
								</TableCell>
							</TableRow>
						) : null}
						{rows.map(row => (
							<TableRow key={row.id}>
								<TableCell>
									<Link className='font-medium hover:underline' href={row.href}>
										{row.number}
									</Link>
									<div className='text-xs text-muted-foreground'>{row.id}</div>
								</TableCell>
								<TableCell>{row.client}</TableCell>
								<TableCell>
									<Badge variant='outline'>{row.status}</Badge>
								</TableCell>
								<TableCell>
									<div>{row.date}</div>
									<div className='text-xs text-muted-foreground'>
										{row.dateLabel}
									</div>
								</TableCell>
								<TableCell className='text-right'>
									{yen.format(row.totalAmount)}
								</TableCell>
								<TableCell>
									<div className='flex justify-end gap-2'>
										<Button asChild variant='outline' size='icon'>
											<Link href={row.pdfHref} target='_blank'>
												<ExternalLinkIcon className='size-4' />
											</Link>
										</Button>
										<form action={row.sendAction}>
											<Button
												type='submit'
												variant='outline'
												size='icon'
												disabled={!row.canSend}
											>
												<MailIcon className='size-4' />
											</Button>
										</form>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	)
}
