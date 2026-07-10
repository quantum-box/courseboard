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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { golfCourseAdminPaths } from 'lib/extension-admin-registry'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchGolfCoursesAction } from '../courses/action'
import type { GolfCourseOption } from './budget-forms'
import { BudgetCsvImportForm, BudgetUpsertForm } from './budget-forms'
import {
	fetchDailyBudgetAchievementAction,
	fetchDailyBudgetsAction,
} from './action'

export const metadata = {
	title: '予算マスタ | TACHYON Field',
}

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function DailyBudgetsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const golfAppHref = `${prefix}/${tenant}${golfCourseAdminPaths.portal}` as Route

	const budgetsResult = await fetchDailyBudgetsAction(tenant)
	const budgets = budgetsResult.success ? budgetsResult.data : []

	// T09: 当月（JST）の達成率。バックエンド未対応時はセクション非表示。
	const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
	const year = nowJst.getUTCFullYear()
	const month = nowJst.getUTCMonth()
	const pad = (n: number) => String(n).padStart(2, '0')
	const monthFrom = `${year}-${pad(month + 1)}-01`
	const monthTo = `${year}-${pad(month + 1)}-${pad(new Date(Date.UTC(year, month + 1, 0)).getUTCDate())}`
	const achievementResult = await fetchDailyBudgetAchievementAction(
		tenant,
		monthFrom,
		monthTo,
	)
	const achievements = achievementResult.success ? achievementResult.data : null

	// Course options from the courses API (T01).
	const coursesResult = await fetchGolfCoursesAction(tenant)
	const courseOptions: GolfCourseOption[] = coursesResult.success
		? coursesResult.data.map(course => ({ id: course.id, name: course.name }))
		: []

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
								<Link href={golfAppHref}>ゴルフアプリ</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>予算マスタ</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout className='pb-8'>
				<div className='flex items-start justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>予算マスタ</h1>
						<p className='mt-1 text-sm text-muted-foreground'>
							コース別・日別の目標売上・客単価・キャディ付き比率を管理します。
						</p>
					</div>
					<Button asChild variant='outline'>
						<Link href={golfAppHref}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							ゴルフアプリへ戻る
						</Link>
					</Button>
				</div>

				<section className='rounded-md border bg-background'>
					<div className='border-b px-4 py-3'>
						<h2 className='text-sm font-semibold'>
							今月の予算達成率（{monthFrom} 〜 {monthTo}）
						</h2>
						<p className='mt-1 text-xs text-muted-foreground'>
							目標（予算マスタ）と実績（予約データ）の日別突き合わせです。
						</p>
					</div>
					{achievements === null ? (
						<p className='px-4 py-6 text-sm text-muted-foreground'>
							達成率APIが未対応のため表示できません（バックエンド更新後に自動で有効になります）。
						</p>
					) : achievements.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>日付</TableHead>
									<TableHead className='text-right'>目標売上</TableHead>
									<TableHead className='text-right'>実績売上</TableHead>
									<TableHead className='text-right'>達成率</TableHead>
									<TableHead className='text-right'>実績客単価（目標）</TableHead>
									<TableHead className='text-right'>キャディ付き比率（目標）</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{achievements.map(a => {
									const rate = a.revenueAchievementRate
									const rateClass =
										rate === null
											? 'text-muted-foreground'
											: rate >= 1
												? 'text-emerald-600 font-semibold'
												: rate >= 0.8
													? 'text-amber-600 font-semibold'
													: 'text-red-600 font-semibold'
									return (
										<TableRow key={a.date}>
											<TableCell>{a.date}</TableCell>
											<TableCell className='text-right'>
												{yen.format(a.targetRevenue)}
											</TableCell>
											<TableCell className='text-right'>
												{yen.format(a.actualRevenue)}
											</TableCell>
											<TableCell className={`text-right ${rateClass}`}>
												{rate === null ? '—' : `${(rate * 100).toFixed(0)}%`}
											</TableCell>
											<TableCell className='text-right'>
												{a.actualAverageSpend === null
													? '—'
													: yen.format(a.actualAverageSpend)}
												<span className='text-xs text-muted-foreground'>
													{' '}
													({yen.format(a.targetAverageSpend)})
												</span>
											</TableCell>
											<TableCell className='text-right'>
												{a.actualCaddyAttachedRatio === null
													? '—'
													: `${(a.actualCaddyAttachedRatio * 100).toFixed(0)}%`}
												<span className='text-xs text-muted-foreground'>
													{' '}
													({(a.targetCaddyAttachedRatio * 100).toFixed(0)}%)
												</span>
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					) : (
						<p className='px-4 py-6 text-sm text-muted-foreground'>
							今月の予算・実績データがありません。
						</p>
					)}
				</section>

				<section className='rounded-md border bg-background p-4'>
					<h2 className='mb-3 text-sm font-semibold'>予算を追加・更新</h2>
					<BudgetUpsertForm tenant={tenant} courseOptions={courseOptions} />
				</section>

				<section className='rounded-md border bg-background p-4'>
					<h2 className='mb-3 text-sm font-semibold'>CSV インポート</h2>
					<BudgetCsvImportForm tenant={tenant} />
				</section>

				<section className='rounded-md border bg-background'>
					<div className='border-b px-4 py-3'>
						<h2 className='text-sm font-semibold'>登録済み予算</h2>
					</div>
					{budgets.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>コースID</TableHead>
									<TableHead>日付</TableHead>
									<TableHead className='text-right'>目標売上</TableHead>
									<TableHead className='text-right'>目標客単価</TableHead>
									<TableHead className='text-right'>キャディ付き比率</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{budgets.map(b => (
									<TableRow key={b.id}>
										<TableCell className='text-xs text-muted-foreground'>
											{b.golfCourseId}
										</TableCell>
										<TableCell>{b.date}</TableCell>
										<TableCell className='text-right'>
											{yen.format(b.targetRevenue)}
										</TableCell>
										<TableCell className='text-right'>
											{yen.format(b.targetAverageSpend)}
										</TableCell>
										<TableCell className='text-right'>
											{(b.targetCaddyAttachedRatio * 100).toFixed(0)}%
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<p className='px-4 py-6 text-sm text-muted-foreground'>
							予算データがありません。
						</p>
					)}
				</section>
			</MainLayout>
		</V1Layout>
	)
}
