import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
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
	fetchDealsAction,
	fetchPipelinesAction,
	type DealData,
	type PipelineStageData,
} from './action'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function DealsPage({
	params: { tenant },
	searchParams: { view = 'kanban', pipeline, stage, clientId },
}: {
	params: { tenant: string }
	searchParams: {
		view?: string
		pipeline?: string
		stage?: string
		clientId?: string
	}
}) {
	const [dealsResult, pipelinesResult] = await Promise.all([
		fetchDealsAction(tenant, { pipeline, stage, clientId }),
		fetchPipelinesAction(tenant),
	])
	const deals = dealsResult.data ?? []
	const pipelines = pipelinesResult.data ?? []
	const activePipeline =
		pipelines.find(item => item.id === pipeline) ?? pipelines[0] ?? null
	const pipelineStages = [...(activePipeline?.stages ?? [])].sort(
		(a, b) => a.displayOrder - b.displayOrder,
	)
	const stages = pipelineStages.length ? pipelineStages : inferStages(deals)
	const mp = getServerModePrefix(tenant)
	const totalAmount = deals.reduce(
		(sum, deal) => sum + Number(deal.amount || 0),
		0,
	)

	return (
		<V1Layout current='deals' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>案件管理</h1>
						<p className='text-sm text-muted-foreground'>
							{deals.length}件 / {yen.format(totalAmount)}
						</p>
					</div>
					<div className='flex flex-wrap gap-2'>
						<Button variant='outline' asChild>
							<Link href={`${mp}/${tenant}/deals/settings` as Route}>
								パイプライン設定
							</Link>
						</Button>
						<Button asChild>
							<Link href={`${mp}/${tenant}/deals/new` as Route}>案件作成</Link>
						</Button>
					</div>
				</div>

				<div className='flex flex-wrap items-center gap-2'>
					<Button
						variant={view === 'list' ? 'outline' : 'default'}
						size='sm'
						asChild
					>
						<Link
							href={
								`${mp}/${tenant}/deals?view=kanban${
									pipeline ? `&pipeline=${pipeline}` : ''
								}` as Route
							}
						>
							Kanban
						</Link>
					</Button>
					<Button
						variant={view === 'list' ? 'default' : 'outline'}
						size='sm'
						asChild
					>
						<Link
							href={
								`${mp}/${tenant}/deals?view=list${
									pipeline ? `&pipeline=${pipeline}` : ''
								}` as Route
							}
						>
							リスト
						</Link>
					</Button>
					{pipelines.map(item => (
						<Button
							key={item.id}
							variant={activePipeline?.id === item.id ? 'secondary' : 'outline'}
							size='sm'
							asChild
						>
							<Link
								href={
									`${mp}/${tenant}/deals?view=${view}&pipeline=${item.id}` as Route
								}
							>
								{item.label}
							</Link>
						</Button>
					))}
				</div>

				{dealsResult.message ? (
					<Card>
						<CardContent className='pt-6 text-sm text-destructive'>
							{dealsResult.message}
						</CardContent>
					</Card>
				) : null}

				{view === 'list' ? (
					<Card>
						<CardHeader>
							<CardTitle>案件一覧</CardTitle>
						</CardHeader>
						<CardContent>
							<DealsTable deals={deals} tenant={tenant} modePrefix={mp} />
						</CardContent>
					</Card>
				) : (
					<DealsKanban
						deals={deals}
						stages={stages}
						tenant={tenant}
						modePrefix={mp}
					/>
				)}
			</MainLayout>
		</V1Layout>
	)
}

function DealsKanban({
	deals,
	stages,
	tenant,
	modePrefix,
}: {
	deals: DealData[]
	stages: PipelineStageData[]
	tenant: string
	modePrefix: string
}) {
	const fallbackStages = stages.length ? stages : inferStages(deals)
	return (
		<div className='grid gap-3 overflow-x-auto pb-2 lg:grid-cols-4'>
			{fallbackStages.map(stage => {
				const stageDeals = deals.filter(deal => deal.stage === stage.id)
				const total = stageDeals.reduce(
					(sum, deal) => sum + Number(deal.amount || 0),
					0,
				)
				return (
					<section
						key={stage.id}
						className='min-w-[260px] rounded-md border bg-muted/30'
					>
						<div className='flex items-center justify-between border-b p-3'>
							<div>
								<h2 className='text-sm font-semibold'>{stage.label}</h2>
								<p className='text-xs text-muted-foreground'>
									{stageDeals.length}件 / {yen.format(total)}
								</p>
							</div>
							<Badge variant='outline'>{stage.id}</Badge>
						</div>
						<div className='space-y-2 p-2'>
							{stageDeals.map(deal => (
								<Link
									key={deal.id}
									href={`${modePrefix}/${tenant}/deals/${deal.id}` as Route}
									className='block rounded-md border bg-background p-3 text-sm hover:bg-muted'
								>
									<div className='font-medium'>{deal.name}</div>
									<div className='mt-2 flex items-center justify-between gap-2'>
										<span className='text-muted-foreground'>
											{deal.clientId}
										</span>
										<span className='font-semibold'>
											{yen.format(Number(deal.amount || 0))}
										</span>
									</div>
									<div className='mt-2 text-xs text-muted-foreground'>
										{deal.ownerName || '担当未設定'}
									</div>
									{deal.memo ? (
										<p className='mt-2 line-clamp-2 text-xs text-muted-foreground'>
											{deal.memo}
										</p>
									) : null}
								</Link>
							))}
							{stageDeals.length === 0 ? (
								<div className='rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground'>
									案件はありません
								</div>
							) : null}
						</div>
					</section>
				)
			})}
		</div>
	)
}

function DealsTable({
	deals,
	tenant,
	modePrefix,
}: {
	deals: DealData[]
	tenant: string
	modePrefix: string
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>案件</TableHead>
					<TableHead>顧客</TableHead>
					<TableHead>ステージ</TableHead>
					<TableHead>担当/メモ</TableHead>
					<TableHead>更新日時</TableHead>
					<TableHead className='text-right'>金額</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{deals.length === 0 ? (
					<TableRow>
						<TableCell colSpan={6} className='h-24 text-center'>
							案件はありません。
						</TableCell>
					</TableRow>
				) : null}
				{deals.map(deal => (
					<TableRow key={deal.id}>
						<TableCell>
							<Link
								className='font-medium hover:underline'
								href={`${modePrefix}/${tenant}/deals/${deal.id}` as Route}
							>
								{deal.name}
							</Link>
							<div className='text-xs text-muted-foreground'>{deal.id}</div>
						</TableCell>
						<TableCell>{deal.clientId}</TableCell>
						<TableCell>
							<Badge variant='outline'>{deal.stage}</Badge>
						</TableCell>
						<TableCell>
							<div>{deal.ownerName || '未設定'}</div>
							<div className='max-w-[280px] truncate text-xs text-muted-foreground'>
								{deal.memo}
							</div>
						</TableCell>
						<TableCell>{formatDateTime(deal.updatedAt)}</TableCell>
						<TableCell className='text-right'>
							{yen.format(Number(deal.amount || 0))}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}

function inferStages(deals: DealData[]): PipelineStageData[] {
	const values = Array.from(new Set(deals.map(deal => deal.stage))).filter(
		Boolean,
	)
	if (!values.length) {
		return [
			{
				id: 'new',
				label: 'New',
				displayOrder: 0,
				createdAt: '',
				updatedAt: '',
			},
		]
	}
	return values.map((value, index) => ({
		id: value,
		label: value,
		displayOrder: index,
		createdAt: '',
		updatedAt: '',
	}))
}

function formatDateTime(value: string) {
	return new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(new Date(value))
}
