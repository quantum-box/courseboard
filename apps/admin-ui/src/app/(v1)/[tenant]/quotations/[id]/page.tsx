import { authWithCheck } from 'app/auth'
import { DocumentPdfDownloadForm } from 'components/document-pdf-download-form'
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
import type { Route } from 'next'
import Link from 'next/link'
import {
	convertQuotationToInvoiceAction,
	fetchQuotationAction,
	updateQuotationAction,
} from '../action'

const statusLabels: Record<string, string> = {
	Draft: '下書き',
	Sent: '送付済',
	Accepted: '承認済',
	Rejected: '却下',
	Expired: '期限切れ',
}

export default async function QuotationDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	const result = await fetchQuotationAction(tenant, id)
	const quotation = result.data
	if (!quotation) {
		throw new Error(result.message ?? '見積書の取得に失敗しました')
	}
	const session = await authWithCheck()
	const pdfSettings = await getDocumentPdfSettings(tenant, session.accessToken)
	const submit = updateQuotationAction.bind(null, tenant, id)
	const convert = convertQuotationToInvoiceAction.bind(null, tenant, id)

	return (
		<V1Layout
			current='quotations'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`/${tenant}/quotations` as Route}>見積書一覧</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{quotation.quotationNumber}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>
							{quotation.quotationNumber}
						</h1>
						<p className='text-sm text-muted-foreground'>
							{quotation.clientName ?? quotation.clientId}
						</p>
					</div>
					<Badge variant='outline'>
						{statusLabels[quotation.status] ?? quotation.status}
					</Badge>
				</div>
				<div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
					<section className='min-w-0'>
						<DocumentPdfDownloadForm
							action={`/${tenant}/quotations/${quotation.id}/pdf`}
							filename={`quotation-${quotation.quotationNumber}.pdf`}
							settings={pdfSettings}
						/>
					</section>
					<aside className='space-y-4'>
						<section className='space-y-3 border-y py-3'>
							<h2 className='text-base font-semibold'>ステータス更新</h2>
							<form action={submit} className='space-y-3'>
								<div className='space-y-1.5'>
									<Label>ステータス</Label>
									<Select name='status' defaultValue={quotation.status}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='Draft'>下書き</SelectItem>
											<SelectItem value='Sent'>送付済</SelectItem>
											<SelectItem value='Accepted'>承認済</SelectItem>
											<SelectItem value='Rejected'>却下</SelectItem>
											<SelectItem value='Expired'>期限切れ</SelectItem>
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
									更新
								</Button>
							</form>
						</section>
						<section className='space-y-3 border-y py-3'>
							<h2 className='text-base font-semibold'>請求書化</h2>
							{quotation.convertedInvoiceId ? (
								<Button asChild className='w-full'>
									<Link
										href={
											`/${tenant}/invoices/${quotation.convertedInvoiceId}` as Route
										}
									>
										作成済み請求書を開く
									</Link>
								</Button>
							) : (
								<form action={convert}>
									<Button type='submit' className='w-full'>
										請求書へ変換
									</Button>
								</form>
							)}
						</section>
					</aside>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
