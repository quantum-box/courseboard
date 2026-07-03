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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { HelpPanel } from 'components/ui/help-panel'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { golfCourseAdminPaths } from 'lib/extension-admin-registry'
import { getServerModePrefix } from 'lib/mode'
import { CalendarCheckIcon, UsersIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchGolfMonthlySettlementAction } from './action'
import { SettlementExportButton } from './settlement-export-button'
import { defaultSettlementYearMonth, formatYen } from './settlement-helpers'
import { SettlementUnpaidCancellationsTable } from './settlement-unpaid-table'

export const metadata = {
	title: '月次精算 | TACHYON Field',
	description:
		'Monthly golf app settlement report (reservations, caddie fees, Square).',
}

export default async function GolfMonthlySettlementPage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams?: { yearMonth?: string }
}) {
	const yearMonth = searchParams?.yearMonth ?? defaultSettlementYearMonth()
	const prefix = getServerModePrefix(tenant)
	const settlementResult = await fetchGolfMonthlySettlementAction(
		tenant,
		yearMonth,
	)
	const report = settlementResult.success ? settlementResult.data : null
	const squareWarning = normalizeSquareWarning(report?.square.warning)

	return (
		<V1Layout
			current='extensions'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/home` as Route}>ホーム</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/extensions` as Route}>
									アプリ
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link
									href={
										`${prefix}/${tenant}${golfCourseAdminPaths.portal}` as Route
									}
								>
									ゴルフアプリ
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>月次精算</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
					<div>
						<h1 className='text-2xl font-semibold'>月次精算</h1>
						<p className='text-sm text-muted-foreground'>
							ゴルフ予約、キャディ費用、キャンセル料、Square
							照合を月次で確認します。会計の月次締めとは分けて扱います。
						</p>
					</div>
					<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
						<Badge variant='outline'>ゴルフアプリ</Badge>
						<Button asChild size='sm' variant='outline'>
							<Link href={`/${tenant}${golfCourseAdminPaths.caddies}` as Route}>
								<UsersIcon className='mr-2 h-4 w-4' aria-hidden />
								キャディ管理
							</Link>
						</Button>
						<Button asChild size='sm' variant='outline'>
							<Link href={`/${tenant}/reports/sales?preset=30d` as Route}>
								<CalendarCheckIcon className='mr-2 h-4 w-4' aria-hidden />
								売上レポート
							</Link>
						</Button>
					</div>
				</div>

				<HelpPanel
					storageKey='golf-monthly-settlement'
					title='精算と売上レポートの違い'
					summary='月次の運用精算です。SKU分析は売上レポートを使用します。'
					sections={[
						{
							title: '売上レポートとの違い',
							content:
								'この画面では、対象月のゴルフ予約、キャディ費用、未収キャンセル料、Square 取込行を集計します。売上レポートは商品やSKUの推移確認に使います。',
						},
					]}
				/>

				<Card>
					<CardHeader className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
						<div>
							<CardTitle>対象期間</CardTitle>
							<CardDescription>
								{report
									? `${report.period.startDate} – ${report.period.endDate}`
									: '月を選択して精算KPIを読み込みます。'}
							</CardDescription>
						</div>
						<SettlementExportButton tenant={tenant} yearMonth={yearMonth} />
					</CardHeader>
					<CardContent className='grid gap-4'>
						<form
							className='flex flex-wrap items-end gap-3'
							action={`/${tenant}${golfCourseAdminPaths.settlement}`}
						>
							<div className='grid gap-1'>
								<Label htmlFor='yearMonth'>対象月</Label>
								<Input
									id='yearMonth'
									name='yearMonth'
									type='month'
									defaultValue={yearMonth}
									className='w-[180px]'
								/>
							</div>
							<Button type='submit' size='sm'>
								読み込み
							</Button>
						</form>
						{!settlementResult.success ? (
							<p className='text-sm text-destructive'>
								{settlementResult.message}
							</p>
						) : report ? (
							<>
								<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
									<KpiCard
										title='予約売上'
										value={formatYen(report.reservations.grossAmount)}
										hint={`${report.reservations.reservationCount} 件`}
									/>
									<KpiCard
										title='入金済み'
										value={formatYen(report.reservations.collectedAmount)}
										hint='予約に対する入金額'
									/>
									<KpiCard
										title='未収'
										value={formatYen(report.reservations.paymentPendingAmount)}
										hint='予約金額から入金額を差し引き'
									/>
									<KpiCard
										title='返金済み'
										value={formatYen(report.reservations.refundedAmount)}
										hint='返金済みステータスの予約'
									/>
									<KpiCard
										title='キャディ費用'
										value={formatYen(
											report.caddieFees.total,
											report.caddieFees.currency,
										)}
										hint={`${report.caddieFees.assignmentCount} 件の割当`}
									/>
									<KpiCard
										title='未収キャンセル料'
										value={formatYen(report.cancellations.feeOutstandingAmount)}
										hint={`${report.cancellations.count} 件`}
									/>
									<KpiCard
										title='Square 入金'
										value={formatYen(report.square.paymentsTotal)}
										hint='取込済み照合行'
									/>
									<KpiCard
										title='Square 返金'
										value={formatYen(report.square.refundsTotal)}
										hint='対象期間のマイナス行'
									/>
									<KpiCard
										title='Square 未照合'
										value={String(report.square.unreconciledLines)}
										hint='未突合の取込行'
									/>
								</div>
								{squareWarning ? (
									<p className='text-sm text-amber-700'>{squareWarning}</p>
								) : null}
								<div className='flex flex-wrap gap-2 text-sm'>
									<Button asChild size='sm' variant='outline'>
										<Link href={`/${tenant}/reservations` as Route}>
											予約一覧 ({report.drilldown.reservationIds.length})
										</Link>
									</Button>
									<Button asChild size='sm' variant='outline'>
										<Link
											href={
												`/${tenant}/accounting/revenue-reconciliation` as Route
											}
										>
											売上照合
										</Link>
									</Button>
								</div>
								<div className='grid gap-2'>
									<h2 className='text-lg font-semibold'>
										未収キャンセル料 (
										{report.drilldown.unpaidCancellationItems.length})
									</h2>
									<p className='text-sm text-muted-foreground'>
										未収キャンセル料に対して Square
										請求書を発行し、G2合計と照合します。
									</p>
									<SettlementUnpaidCancellationsTable
										tenant={tenant}
										items={report.drilldown.unpaidCancellationItems}
									/>
								</div>
							</>
						) : null}
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}

function KpiCard({
	title,
	value,
	hint,
}: {
	title: string
	value: string
	hint: string
}) {
	return (
		<div className='rounded-lg border p-4'>
			<p className='text-sm text-muted-foreground'>{title}</p>
			<p className='mt-1 text-2xl font-semibold'>{value}</p>
			<p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
		</div>
	)
}

function normalizeSquareWarning(value?: string | null) {
	if (!value) return null
	if (value.includes('square_payment_reconciliations')) {
		return 'Square 照合テーブルが未設定のため、Square 入金・返金・未照合は参考値として表示しています。'
	}
	return value
}
