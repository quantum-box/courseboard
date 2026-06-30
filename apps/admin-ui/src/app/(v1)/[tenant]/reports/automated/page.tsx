import { ReportActions } from 'app/(v1)/[tenant]/reports/automated/_components/report-actions'
import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getBackendBaseUrl } from 'lib/backendUrl'
import {
	getServerModePrefix,
	getModeFromOperatorId,
	getPlatformIdForMode,
} from 'lib/mode'
import { Bot, CalendarClock } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = {
	title: '自動レポート | TACHYON Field',
	description: 'Agent が生成した週次・月次の売上分析レポート',
}

type AgentReport = {
	id: string
	tenantId: string
	period: 'weekly' | 'monthly' | string
	content: string
	sourceSessionId?: string | null
	generatedAt: string
	createdAt: string
}

type AgentReportListResponse = {
	items: AgentReport[]
}

export default async function AgentReportsPage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)
	const session = await authWithCheck()
	const reports = await fetchReports(tenant, session.accessToken)

	const latest = reports[0]

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
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/reports/sales` as Route}>
									売上分析
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>自動レポート</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
					<div>
						<h1 className='flex items-center gap-2 text-xl font-semibold'>
							<Bot className='h-5 w-5' aria-hidden='true' />
							自動レポート
						</h1>
						<p className='mt-1 text-sm text-muted-foreground'>
							Agent が週次・月次の売上 KPI、上位 SKU、異常検知、next action
							を経営報告向けに整理します。
						</p>
					</div>
					<Button variant='outline' size='sm' asChild>
						<Link href={`${prefix}/${tenant}/reports/sales` as Route}>
							売上分析へ戻る
						</Link>
					</Button>
				</div>

				<ReportActions
					tenant={tenant}
					accessToken={session.accessToken}
				/>

				<div className='grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]'>
					<Card>
						<CardHeader>
							<CardTitle className='text-base'>保存済みレポート</CardTitle>
							<CardDescription>
								新しい順に最大50件を表示します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							{reports.length === 0 ? (
								<p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
									保存済みレポートはまだありません。
								</p>
							) : (
								<div className='space-y-2'>
									{reports.map(report => (
										<a
											key={report.id}
											href={`#${report.id}`}
											className='block rounded-md border p-3 transition-colors hover:bg-muted/50'
										>
											<div className='flex items-center justify-between gap-2'>
												<Badge variant='secondary'>
													{periodLabel(report.period)}
												</Badge>
												<span className='text-xs text-muted-foreground'>
													{formatDateTime(report.generatedAt)}
												</span>
											</div>
											<p className='mt-2 line-clamp-2 text-sm text-muted-foreground'>
												{report.content}
											</p>
										</a>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					<div className='space-y-4'>
						{latest ? (
							reports.map(report => (
								<Card key={report.id} id={report.id}>
									<CardHeader>
										<div className='flex flex-wrap items-center gap-2'>
											<Badge>{periodLabel(report.period)}</Badge>
											<span className='flex items-center gap-1 text-sm text-muted-foreground'>
												<CalendarClock className='h-4 w-4' aria-hidden='true' />
												{formatDateTime(report.generatedAt)}
											</span>
										</div>
										<CardTitle className='text-lg'>
											{periodLabel(report.period)}売上分析レポート
										</CardTitle>
										<CardDescription className='font-mono text-xs'>
											{report.sourceSessionId ?? report.id}
										</CardDescription>
									</CardHeader>
									<CardContent>
										<pre className='whitespace-pre-wrap break-words text-sm leading-7'>
											{report.content}
										</pre>
									</CardContent>
								</Card>
							))
						) : (
							<Card>
								<CardContent className='py-12 text-center text-sm text-muted-foreground'>
									週次または月次レポートを生成するとここに表示されます。
								</CardContent>
							</Card>
						)}
					</div>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

async function fetchReports(
	tenant: string,
	accessToken: string,
): Promise<AgentReport[]> {
	const mode = getModeFromOperatorId(tenant)
	try {
		const response = await fetch(
			`${getBackendBaseUrl()}/v1/field/agent/reports?limit=50`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'x-operator-id': tenant,
					'x-platform-id': getPlatformIdForMode(mode),
				},
			},
		)
		if (!response.ok) {
			return []
		}
		const data = (await response.json()) as AgentReportListResponse
		return data.items
	} catch {
		return []
	}
}

function periodLabel(period: string): string {
	return period === 'monthly' ? '月次' : '週次'
}

function formatDateTime(value: string): string {
	return new Intl.DateTimeFormat('ja-JP', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Asia/Tokyo',
	}).format(new Date(value))
}
