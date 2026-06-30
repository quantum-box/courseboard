import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from 'components/ui/breadcrumb'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { PageHeader } from 'components/ui/page-shell'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import {
	BarChart3Icon,
	BookOpenCheckIcon,
	BotIcon,
	CalendarCheckIcon,
	FileSearchIcon,
	LineChartIcon,
	type LucideProps,
	ReceiptTextIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type React from 'react'

export const metadata = {
	title: 'レポート | TACHYON Field',
	description:
		'売上、会計、月次締め、証憑レポートの入口をまとめた canonical reports hub',
}

type ReportLink = {
	title: string
	description: string
	href: string
	icon: React.ForwardRefExoticComponent<
		Omit<LucideProps, 'ref'> & React.RefAttributes<SVGSVGElement>
	>
	badge: string
	primary?: boolean
}

export default function ReportsRoute({
	params: { tenant },
}: {
	params: {
		tenant: string
	}
}) {
	const prefix = getServerModePrefix(tenant)
	const reports: ReportLink[] = [
		{
			title: '売上分析',
			description:
				'日次・月次の売上推移、上位 SKU、期間別フィルタを確認します。',
			href: '/reports/sales',
			icon: LineChartIcon,
			badge: 'Sales',
			primary: true,
		},
		{
			title: '自動レポート',
			description: 'Agent が生成した週次・月次の売上分析レポートを確認します。',
			href: '/reports/automated',
			icon: BotIcon,
			badge: 'Agent',
			primary: true,
		},
		{
			title: 'キャンセル料',
			description:
				'予約キャンセル料の未請求、請求リンク発行済み、支払済みを確認します。',
			href: '/reports/cancellation-fees',
			icon: ReceiptTextIcon,
			badge: 'Reservations',
			primary: true,
		},
		{
			title: 'ERP ダッシュボード',
			description: '売上、原価、粗利、粗利率の概況を確認します。',
			href: '/erp/dashboard',
			icon: BarChart3Icon,
			badge: 'ERP',
		},
		{
			title: '売上台帳',
			description: '売上入力、CSV 出力、売上明細の確認に進みます。',
			href: '/erp/sales-ledger',
			icon: ReceiptTextIcon,
			badge: 'Ledger',
		},
		{
			title: '仕入台帳',
			description: '仕入入力、CSV 出力、仕入明細の確認に進みます。',
			href: '/erp/purchase-ledger',
			icon: BookOpenCheckIcon,
			badge: 'Ledger',
		},
		{
			title: '月次締め',
			description: '締め前チェック、例外、再オープン操作を確認します。',
			href: '/accounting/monthly-closing',
			icon: CalendarCheckIcon,
			badge: 'Close',
		},
		{
			title: '証憑検索',
			description: '証憑、OCR、監査用エクスポートの入口に進みます。',
			href: '/erp/evidence',
			icon: FileSearchIcon,
			badge: 'Evidence',
		},
	]

	return (
		<V1Layout
			current='erp-reports'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>レポート</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='レポート'
					description='月次、売上、会計、証憑レポートの入口をこの画面に統合します'
				/>

				<div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
					{reports.map(report => {
						const Icon = report.icon
						return (
							<Card key={report.href}>
								<CardHeader className='space-y-3'>
									<div className='flex items-start justify-between gap-3'>
										<div className='flex items-center gap-2'>
											<Icon
												className='h-5 w-5 text-muted-foreground'
												aria-hidden
											/>
											<CardTitle className='text-base'>
												{report.title}
											</CardTitle>
										</div>
										<Badge variant={report.primary ? 'default' : 'secondary'}>
											{report.badge}
										</Badge>
									</div>
									<CardDescription>{report.description}</CardDescription>
								</CardHeader>
								<CardContent>
									<Button
										variant={report.primary ? 'default' : 'outline'}
										size='sm'
										asChild
									>
										<Link href={`${prefix}/${tenant}${report.href}` as Route}>
											開く
										</Link>
									</Button>
								</CardContent>
							</Card>
						)
					})}
				</div>
			</MainLayout>
		</V1Layout>
	)
}
