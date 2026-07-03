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
import type { GolfCourseOption } from './budget-forms'
import { BudgetCsvImportForm, BudgetUpsertForm } from './budget-forms'
import { fetchDailyBudgetsAction } from './action'

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

	// Course options from T01 courses API (empty until T01 merges)
	const courseOptions: GolfCourseOption[] = []

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
