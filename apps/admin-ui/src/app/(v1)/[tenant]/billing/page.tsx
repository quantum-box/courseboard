import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import {
	fetchBillingCenterAction,
	resendPaymentLinkAction,
	updateFollowUpStatusAction,
} from './action'
import { BillingQueueClient } from './billing-queue-client'

export const metadata = {
	title: 'Billing Center | TACHYON Field',
	description: '未払い請求、AR残高、支払リンク、照合例外を集約します。',
}

const jpy = new Intl.NumberFormat('ja-JP', {
	currency: 'JPY',
	maximumFractionDigits: 0,
	style: 'currency',
})

function formatAmount(value: number, currency = 'JPY') {
	if (currency === 'JPY') {
		return jpy.format(value)
	}
	return new Intl.NumberFormat('ja-JP', {
		currency,
		maximumFractionDigits: 2,
		style: 'currency',
	}).format(value)
}

function SummaryCard({
	label,
	value,
	amount,
}: {
	label: string
	value: number
	amount?: number
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
				{typeof amount === 'number' ? (
					<div className='mt-1 text-sm text-muted-foreground'>
						{formatAmount(amount)}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}

export default async function BillingCenterPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const result = await fetchBillingCenterAction(tenant)
	const data = result.data
	const mp = getServerModePrefix(tenant)

	return (
		<V1Layout
			current='billing-center'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/home` as Route}>ホーム</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>Billing Center</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex flex-wrap items-start justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold tracking-normal'>
							Billing Center
						</h1>
						<p className='text-sm text-muted-foreground'>
							未払い請求、売掛残高、支払リンク、Square照合例外を1画面で確認します。
						</p>
					</div>
					<div className='flex flex-wrap gap-2'>
						<Button variant='outline' asChild>
							<Link href={`/${tenant}/invoices/new` as Route}>請求書作成</Link>
						</Button>
						<Button variant='outline' asChild>
							<Link
								href={`/${tenant}/accounting/revenue-reconciliation` as Route}
							>
								入金消込
							</Link>
						</Button>
					</div>
				</div>

				{result.success ? null : (
					<Card className='border-red-200 bg-red-50'>
						<CardContent className='pt-6 text-sm text-red-700'>
							{result.message ?? 'Billing Center の取得に失敗しました'}
						</CardContent>
					</Card>
				)}

				{data?.errors.length ? (
					<Card className='border-amber-200 bg-amber-50'>
						<CardHeader>
							<CardTitle className='text-sm text-amber-900'>
								一部データを取得できませんでした
							</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className='grid gap-1 text-sm text-amber-900'>
								{data.errors.map(error => (
									<li key={error}>{error}</li>
								))}
							</ul>
						</CardContent>
					</Card>
				) : null}

				<div className='grid gap-3 md:grid-cols-5'>
					<SummaryCard
						label='未払い請求'
						value={data?.summary.unpaidInvoiceCount ?? 0}
						amount={data?.summary.unpaidInvoiceAmount ?? 0}
					/>
					<SummaryCard
						label='期限超過'
						value={data?.summary.overdueInvoiceCount ?? 0}
						amount={data?.summary.overdueInvoiceAmount ?? 0}
					/>
					<SummaryCard
						label='AR残高'
						value={data?.summary.receivableOutstanding ? 1 : 0}
						amount={data?.summary.receivableOutstanding ?? 0}
					/>
					<SummaryCard
						label='支払リンク'
						value={data?.summary.paymentLinkCount ?? 0}
					/>
					<SummaryCard
						label='照合例外'
						value={data?.summary.reconciliationExceptionCount ?? 0}
					/>
				</div>

				<BillingQueueClient
					items={data?.queue ?? []}
					tenant={tenant}
					resendPaymentLink={resendPaymentLinkAction.bind(null, tenant)}
					updateFollowUpStatus={updateFollowUpStatusAction.bind(null, tenant)}
				/>
			</MainLayout>
		</V1Layout>
	)
}
