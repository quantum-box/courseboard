import { AnalyticsCharts } from 'app/(v1)/[tenant]/reports/sales/_components/analytics-charts'
import {
	type PeriodPreset,
	PeriodControls,
} from 'app/(v1)/[tenant]/reports/sales/_components/period-controls'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import { HelpPanel } from 'components/ui/help-panel'
import { PageHeader } from 'components/ui/page-shell'
import { Skeleton } from 'components/ui/skeleton'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import { Bot } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

export const metadata = {
	title: '売上分析 | TACHYON Field',
	description:
		'日次・月次の売上推移と売上上位SKUを確認できる分析ダッシュボード',
}

const PRESETS = new Set<PeriodPreset>(['7d', '30d', '90d', 'custom'])

function pad(n: number): string {
	return n.toString().padStart(2, '0')
}

function formatYmd(date: Date): string {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function isValidYmd(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

function resolvePeriod(searchParams: {
	preset?: string
	from?: string
	to?: string
}): { preset: PeriodPreset; from: string; to: string } {
	const presetParam = (searchParams.preset ?? '30d') as PeriodPreset
	const preset = PRESETS.has(presetParam) ? presetParam : '30d'
	const today = new Date()
	const todayUtc = new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
	const to = formatYmd(todayUtc)

	const daysFromPreset =
		preset === '7d' ? 6 : preset === '90d' ? 89 : preset === '30d' ? 29 : null

	if (preset === 'custom') {
		const customFrom =
			searchParams.from && isValidYmd(searchParams.from)
				? searchParams.from
				: formatYmd(new Date(todayUtc.getTime() - 29 * 86_400_000))
		const customTo =
			searchParams.to && isValidYmd(searchParams.to) ? searchParams.to : to
		const fromOk =
			Date.parse(customFrom) <= Date.parse(customTo) ? customFrom : customTo
		return { preset, from: fromOk, to: customTo }
	}

	const fromDate = new Date(
		todayUtc.getTime() - (daysFromPreset ?? 29) * 86_400_000,
	)
	return { preset, from: formatYmd(fromDate), to }
}

function normalizeFilter(value: string | undefined): string {
	return value && value.trim() !== '' ? value.trim() : 'all'
}

function monthRangeFor(
	from: string,
	to: string,
): {
	monthFrom: string
	monthTo: string
} {
	const f = new Date(from)
	const t = new Date(to)
	const fStart = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1))
	const tStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))
	// Fallback to 12 months if the requested range is shorter.
	const minStart = new Date(
		Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 11, 1),
	)
	const start = fStart.getTime() < minStart.getTime() ? fStart : minStart
	return { monthFrom: formatYmd(start), monthTo: formatYmd(tStart) }
}

export default async function AnalyticsPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>
	searchParams: Promise<{
		preset?: string
		from?: string
		to?: string
		channel?: string
		sku?: string
		customerSegment?: string
	}>
}) {
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)
	const sp = await searchParams
	const { preset, from, to } = resolvePeriod(sp)
	const { monthFrom, monthTo } = monthRangeFor(from, to)
	const channel = normalizeFilter(sp.channel)
	const sku = sp.sku?.trim() ?? ''
	const customerSegment = normalizeFilter(sp.customerSegment)

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
							<BreadcrumbPage>売上分析</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='売上分析'
					description='日次・月次の売上推移と売上上位SKUを確認します'
					actions={
						<Button variant='outline' size='sm' asChild>
							<Link href={`${prefix}/${tenant}/reports/automated` as Route}>
								<Bot className='mr-2 h-4 w-4' aria-hidden='true' />
								自動レポート
							</Link>
						</Button>
					}
				/>
				<HelpPanel
					storageKey='analytics'
					title='売上分析の見方'
					summary='確定済み注文の売上を日次・月次・SKU別で可視化します'
					sections={[
						{
							title: '集計対象',
							content:
								'TACHYON Field Commerce で confirmed_at が記録され、status が cancelled でない注文を集計しています。テナント単位でスコープされます。',
						},
						{
							title: '通貨単位',
							content:
								'画面表示は USD ($) です。データは NanoDollar (10^-9 USD) でバックエンドから受け取り、フロントで USD に換算しています。',
						},
						{
							title: '期間の選び方',
							content:
								'プリセット（7日 / 30日 / 90日）またはカスタム日付範囲で期間を指定できます。月次グラフは選択した期間を含む直近12ヶ月分を表示します。',
						},
					]}
				/>

				<Suspense fallback={null}>
					<PeriodControls
						preset={preset}
						from={from}
						to={to}
						channel={channel}
						sku={sku}
						customerSegment={customerSegment}
					/>
				</Suspense>

				<Suspense
					fallback={
						<div className='flex flex-col gap-4'>
							<Skeleton className='h-[260px] w-full rounded-lg' />
							<Skeleton className='h-[260px] w-full rounded-lg' />
							<Skeleton className='h-[260px] w-full rounded-lg' />
						</div>
					}
				>
					<AnalyticsCharts
						tenant={tenant}
						from={from}
						to={to}
						monthFrom={monthFrom}
						monthTo={monthTo}
						channel={channel}
						sku={sku}
						customerSegment={customerSegment}
					/>
				</Suspense>
			</MainLayout>
		</V1Layout>
	)
}
