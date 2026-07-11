import { authWithCheck } from 'app/auth'
import { DocumentPdfDownloadForm } from 'components/document-pdf-download-form'
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
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getDocumentPdfSettings } from 'lib/document-pdf-settings'
import { ExternalLinkIcon, RefreshCwIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchInvoiceAction, updateInvoiceStatusAction } from '../action'
import { invoiceStatusLabels, invoiceStatusVariants } from '../view-model'
import { CopyPaymentLink } from './copy-payment-link'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function InvoiceDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	const result = await fetchInvoiceAction(tenant, id)
	const invoice = result.data
	if (!invoice) {
		throw new Error(result.message ?? '請求書の取得に失敗しました')
	}
	const session = await authWithCheck()
	const pdfSettings = await getDocumentPdfSettings(tenant, session.accessToken)
	const submit = updateInvoiceStatusAction.bind(null, tenant, id)
	const publicPaymentUrl = invoice.paymentLinkUrl ?? ''

	return (
		<V1Layout
			current='invoices'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`/${tenant}/invoices` as Route}>請求書一覧</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{invoice.invoiceNumber}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>{invoice.invoiceNumber}</h1>
						<p className='text-sm text-muted-foreground'>
							{invoice.clientName ?? invoice.clientId}
						</p>
					</div>
					<Badge variant={invoiceStatusVariants[invoice.status]}>
						{invoiceStatusLabels[invoice.status]}
					</Badge>
				</div>
				<div className='grid gap-3 md:grid-cols-4'>
					<StatusTile
						label='支払い状態'
						value={invoice.status === 'Paid' ? '入金済' : '未入金'}
						description={
							invoice.paidAt ? formatDateTime(invoice.paidAt) : '入金日時なし'
						}
					/>
					<StatusTile
						label='請求金額'
						value={yen.format(invoice.totalAmount)}
						description={`${invoice.currency} / 税 ${yen.format(invoice.taxAmount)}`}
					/>
					<StatusTile
						label='支払期限'
						value={formatDate(invoice.dueDate)}
						description={
							invoice.status !== 'Paid' && isPastDue(invoice.dueDate)
								? '期限超過'
								: '期限内または入金済'
						}
					/>
					<StatusTile
						label='最終更新'
						value={formatDateTime(invoice.updatedAt)}
						description={`作成 ${formatDateTime(invoice.createdAt)}`}
					/>
				</div>
				<div className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card className='min-w-0'>
						<CardHeader className='flex flex-row items-center justify-between gap-3'>
							<CardTitle>請求書プレビュー</CardTitle>
							<div className='flex gap-2'>
								{invoice.paymentLinkUrl ? (
									<Button asChild variant='outline'>
										<Link
											href={invoice.paymentLinkUrl as Route}
											target='_blank'
											rel='noreferrer'
										>
											<ExternalLinkIcon className='mr-2 size-4' />
											支払いページ
										</Link>
									</Button>
								) : null}
							</div>
						</CardHeader>
						<CardContent>
							<DocumentPdfDownloadForm
								action={`/${tenant}/invoices/${invoice.id}/pdf`}
								filename={`invoice-${invoice.invoiceNumber}.pdf`}
								settings={pdfSettings}
							/>
						</CardContent>
					</Card>
					<div className='space-y-4'>
						<Card>
							<CardHeader>
								<CardTitle>運用情報</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3 text-sm'>
								<InfoRow label='請求書ID' value={invoice.id} />
								<InfoRow label='テナントID' value={invoice.tenantId} />
								<InfoRow label='取引先ID' value={invoice.clientId} />
								<InfoRow
									label='取引先メール'
									value={invoice.clientEmail ?? '-'}
								/>
								<InfoRow
									label='支払いリンク'
									value={invoice.paymentLinkUrl ? '発行済み' : '未発行'}
								/>
								<InfoRow
									label='Square Link ID'
									value={invoice.squarePaymentLinkId ?? '-'}
								/>
								<InfoRow label='送付日時' value={formatDateTime(invoice.sentAt)} />
								<InfoRow label='入金日時' value={formatDateTime(invoice.paidAt)} />
								<InfoRow label='対象受注' value='未設定' />
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>ステータス更新</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								{invoice.paymentLinkUrl ? (
									<div className='space-y-2 rounded-md border bg-muted/30 p-3'>
										<Label>公開支払いページURL</Label>
										<Input readOnly value={publicPaymentUrl} />
										<Button asChild variant='outline' className='w-full'>
											<a
												href={publicPaymentUrl}
												target='_blank'
												rel='noreferrer'
											>
												公開ページを開く
											</a>
										</Button>
										<CopyPaymentLink url={publicPaymentUrl} />
									</div>
								) : null}
								<form action={submit} className='space-y-4'>
									<div>
										<Label>ステータス</Label>
										<Select name='status' defaultValue={invoice.status}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value='Draft'>下書き</SelectItem>
												<SelectItem value='Sent'>送付済</SelectItem>
												<SelectItem value='SendFailed'>送信失敗</SelectItem>
												<SelectItem value='Paid'>入金済</SelectItem>
												<SelectItem value='Overdue'>期限超過</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<label className='flex items-center gap-2 text-sm'>
										<input name='createPaymentLink' type='checkbox' />
										Payment Linkを再生成
									</label>
									<label className='flex items-center gap-2 text-sm'>
										<input name='sendEmail' type='checkbox' />
										メール送信
									</label>
									<Button type='submit' className='w-full'>
										<RefreshCwIcon className='mr-2 size-4' />
										更新
									</Button>
								</form>
							</CardContent>
						</Card>
						{invoice.notes ? (
							<Card>
								<CardHeader>
									<CardTitle>メモ</CardTitle>
								</CardHeader>
								<CardContent className='whitespace-pre-wrap text-sm text-muted-foreground'>
									{invoice.notes}
								</CardContent>
							</Card>
						) : null}
					</div>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

function StatusTile({
	label,
	value,
	description,
}: {
	label: string
	value: string
	description: string
}) {
	return (
		<Card>
			<CardHeader className='pb-2'>
				<CardTitle className='text-sm font-medium text-muted-foreground'>
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className='text-2xl font-semibold'>{value}</div>
				<div className='text-xs text-muted-foreground'>{description}</div>
			</CardContent>
		</Card>
	)
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className='grid grid-cols-[112px_minmax(0,1fr)] gap-3'>
			<div className='text-muted-foreground'>{label}</div>
			<div className='min-w-0 break-all'>{value}</div>
		</div>
	)
}

function formatDate(value?: string | null) {
	if (!value) return '-'
	return value.slice(0, 10)
}

function formatDateTime(value?: string | null) {
	if (!value) return '-'
	return new Date(value).toLocaleString('ja-JP')
}

function isPastDue(dueDate: string) {
	return new Date(dueDate).getTime() < Date.now()
}
