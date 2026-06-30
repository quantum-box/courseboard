import { ToastClient } from 'components/toast-client'
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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
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
import type { Route } from 'next'
import Link from 'next/link'
import {
	getCloseReadinessSummary,
	getMonthlyClosingSummary,
} from '../../procurement/_lib/erp-api'
import {
	closeMonthlyClosingAction,
	reopenMonthlyClosingAction,
} from './actions'
import { CloseReadinessCockpit } from './close-readiness-cockpit'

export const metadata = {
	title: '月次締め | TACHYON Field',
	description: '請求・証憑・入金照合・仕訳状態を月次締め観点で確認します。',
}

function formatDate(value: string | null): string {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return date.toLocaleDateString('ja-JP')
}

function formatStatus(status: string) {
	if (status === 'closed') return '締め済み'
	if (status === 'reopened') return '再オープン'
	return '未締め'
}

function issueLabel(kind: string) {
	const labels: Record<string, string> = {
		draft_invoice: '請求書未確定',
		unposted_journal_entry: '仕訳未確定',
		unjournalized_sales_event: '未計上',
		unreconciled_payment: '未照合',
		missing_evidence: '証憑不足',
	}
	return labels[kind] ?? kind
}

export default async function MonthlyClosingPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>
	searchParams: Promise<{
		companyId?: string
		yearMonth?: string
		flash?: string
		source?: string
	}>
}) {
	const { tenant } = await params
	const query = await searchParams
	const prefix = getServerModePrefix(tenant)
	const companyId = query.companyId?.trim() ?? ''
	const yearMonth = query.yearMonth ?? '2026-04'
	const result = companyId
		? await getMonthlyClosingSummary(tenant, {
				companyId,
				yearMonth,
			}).catch(error => {
				console.error('Failed to load monthly closing summary:', error)
				return null
			})
		: null
	const summary = result?.summary
	const source = result?.source
	const readinessResult = summary
		? await getCloseReadinessSummary(tenant, {
				companyId,
				yearMonth,
			}).catch(error => {
				console.error('Failed to load close readiness cockpit:', error)
				return null
			})
		: null
	const criticalCloseBlockers = readinessResult?.summary.criticalCount ?? 0

	return (
		<V1Layout
			current='accounting'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/home` as Route}>Home</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>月次締め</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				{query.flash && (
					<ToastClient
						title={
							query.flash === 'closed'
								? '月次締めを確定しました'
								: '月次締めを再オープンしました'
						}
						description={
							query.flash === 'closed'
								? '会計APIで期間をロックし、繰越残高を確定しました'
								: '会計APIで期間を再オープンしました'
						}
						variant='default'
					/>
				)}

				<div className='space-y-4'>
					<Card>
						<CardHeader>
							<CardTitle>月次締めチェック</CardTitle>
							<CardDescription>
								対象月の請求書・証憑・支払照合・仕訳状態を確認します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form className='grid gap-3 md:grid-cols-[1fr_180px_auto]'>
								<div className='space-y-2'>
									<Label htmlFor='companyId'>Company ID</Label>
									<Input
										id='companyId'
										name='companyId'
										defaultValue={companyId}
									/>
								</div>
								<div className='space-y-2'>
									<Label htmlFor='yearMonth'>対象月</Label>
									<Input
										id='yearMonth'
										name='yearMonth'
										type='month'
										defaultValue={yearMonth}
									/>
								</div>
								<div className='flex items-end'>
									<Button type='submit'>確認</Button>
								</div>
							</form>
						</CardContent>
					</Card>

					{summary ? (
						<>
							<div className='grid gap-3 md:grid-cols-5'>
								<Card>
									<CardHeader className='pb-2'>
										<CardDescription>状態</CardDescription>
										<CardTitle>{formatStatus(summary.status)}</CardTitle>
									</CardHeader>
									<CardContent>
										<Badge variant='outline'>{source}</Badge>
									</CardContent>
								</Card>
								<Card>
									<CardHeader className='pb-2'>
										<CardDescription>未解決</CardDescription>
										<CardTitle>{summary.issueCount}</CardTitle>
									</CardHeader>
									<CardContent className='text-sm text-muted-foreground'>
										{summary.issueCount === 0 ? '締め可能' : '確認が必要'}
									</CardContent>
								</Card>
								<Card>
									<CardHeader className='pb-2'>
										<CardDescription>未計上</CardDescription>
										<CardTitle>
											{summary.unjournalizedSalesEventCount}
										</CardTitle>
									</CardHeader>
									<CardContent className='text-sm text-muted-foreground'>
										売上イベント {summary.salesEventCount} 件
									</CardContent>
								</Card>
								<Card>
									<CardHeader className='pb-2'>
										<CardDescription>未照合</CardDescription>
										<CardTitle>{summary.unreconciledPaymentCount}</CardTitle>
									</CardHeader>
									<CardContent className='text-sm text-muted-foreground'>
										支払証憑 {summary.paymentReconciliationCount} 件
									</CardContent>
								</Card>
								<Card>
									<CardHeader className='pb-2'>
										<CardDescription>証憑不足</CardDescription>
										<CardTitle>{summary.missingEvidenceCount}</CardTitle>
									</CardHeader>
									<CardContent className='text-sm text-muted-foreground'>
										電子取引 {summary.evidenceTransactionCount} 件
									</CardContent>
								</Card>
							</div>

							<CloseReadinessCockpit
								prefix={prefix}
								tenant={tenant}
								readiness={readinessResult?.summary ?? null}
							/>

							<Card>
								<CardHeader className='flex flex-row items-start justify-between gap-3'>
									<div>
										<CardTitle>締め操作</CardTitle>
										<CardDescription>
											{summary.periodStart} から {summary.periodEnd} まで
										</CardDescription>
									</div>
									<div className='flex gap-2'>
										<form action={closeMonthlyClosingAction.bind(null, tenant)}>
											<input type='hidden' name='companyId' value={companyId} />
											<input type='hidden' name='yearMonth' value={yearMonth} />
											<input
												type='hidden'
												name='note'
												value='Closed from tachyon-field-admin-ui'
											/>
											<Button
												type='submit'
												disabled={
													criticalCloseBlockers > 0 ||
													summary.status === 'closed'
												}
											>
												締め確定
											</Button>
										</form>
										<form
											action={reopenMonthlyClosingAction.bind(null, tenant)}
										>
											<input type='hidden' name='companyId' value={companyId} />
											<input type='hidden' name='yearMonth' value={yearMonth} />
											<input
												type='hidden'
												name='note'
												value='Reopened from tachyon-field-admin-ui'
											/>
											<Button
												type='submit'
												variant='outline'
												disabled={summary.status !== 'closed'}
											>
												再オープン
											</Button>
										</form>
									</div>
								</CardHeader>
								{criticalCloseBlockers > 0 ? (
									<CardContent className='pt-0'>
										<div className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
											未解消の要対応ブロッカーが {criticalCloseBlockers}{' '}
											件あります。上の締め前コックピットから対象レコードへ移動し、解消後に締め確定してください。
										</div>
									</CardContent>
								) : null}
								<CardContent className='grid gap-3 md:grid-cols-3 text-sm'>
									<div>
										<p className='text-muted-foreground'>請求書</p>
										<p>
											draft {summary.draftInvoiceCount} / total{' '}
											{summary.invoiceCount}
										</p>
									</div>
									<div>
										<p className='text-muted-foreground'>仕訳</p>
										<p>
											unposted {summary.unpostedJournalEntryCount} / total{' '}
											{summary.journalEntryCount}
										</p>
									</div>
									<div>
										<p className='text-muted-foreground'>更新時刻</p>
										<p>
											close {formatDate(summary.closedAt)} / reopen{' '}
											{formatDate(summary.reopenedAt)}
										</p>
									</div>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>未解決リスト</CardTitle>
									<CardDescription>
										締め前に処理が必要な取引・証憑・仕訳を表示します。
									</CardDescription>
								</CardHeader>
								<CardContent>
									{summary.issues.length === 0 ? (
										<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
											未解決項目はありません。
										</div>
									) : (
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>種別</TableHead>
													<TableHead>ID</TableHead>
													<TableHead>日付</TableHead>
													<TableHead className='text-right'>金額</TableHead>
													<TableHead>状態</TableHead>
													<TableHead>説明</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{summary.issues.map(issue => (
													<TableRow key={`${issue.kind}-${issue.id}`}>
														<TableCell>{issueLabel(issue.kind)}</TableCell>
														<TableCell className='font-mono text-xs'>
															{issue.id}
														</TableCell>
														<TableCell>
															{formatDate(issue.occurredOn)}
														</TableCell>
														<TableCell className='text-right tabular-nums'>
															{issue.amount ?? '-'}
														</TableCell>
														<TableCell>{issue.status}</TableCell>
														<TableCell>{issue.description ?? '-'}</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									)}
								</CardContent>
							</Card>
						</>
					) : (
						<Card>
							<CardContent className='p-8 text-center text-sm text-muted-foreground'>
								{companyId
									? '月次締めサマリーを取得できませんでした。'
									: 'Company ID を入力して月次締めサマリーを確認してください。'}
							</CardContent>
						</Card>
					)}
				</div>
			</MainLayout>
		</V1Layout>
	)
}
