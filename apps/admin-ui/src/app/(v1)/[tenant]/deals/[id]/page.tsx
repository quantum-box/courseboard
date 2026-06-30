import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import { Textarea } from 'components/ui/textarea'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import {
	fetchDealAction,
	fetchPipelinesAction,
	updateDealAction,
} from '../action'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function DealDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	const [dealResult, pipelinesResult] = await Promise.all([
		fetchDealAction(tenant, id),
		fetchPipelinesAction(tenant),
	])
	const deal = dealResult.data
	if (!deal) {
		throw new Error(dealResult.message ?? '案件の取得に失敗しました')
	}
	const pipelines = pipelinesResult.data ?? []
	const activePipeline =
		pipelines.find(pipeline => pipeline.id === deal.pipeline) ?? pipelines[0]
	const stages = activePipeline?.stages ?? []
	const submit = updateDealAction.bind(null, tenant, id)
	const mp = getServerModePrefix(tenant)

	return (
		<V1Layout current='deals' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>{deal.name}</h1>
						<p className='text-sm text-muted-foreground'>
							{deal.clientId} / {deal.id}
						</p>
					</div>
					<div className='flex items-center gap-2'>
						<Badge variant='outline'>{deal.stage}</Badge>
						<Button variant='outline' asChild>
							<Link href={`${mp}/${tenant}/deals` as Route}>一覧へ戻る</Link>
						</Button>
					</div>
				</div>

				<form action={submit} className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader>
							<CardTitle>案件情報</CardTitle>
						</CardHeader>
						<CardContent className='grid gap-4 md:grid-cols-2'>
							<div className='md:col-span-2'>
								<Label>案件名</Label>
								<Input name='name' defaultValue={deal.name} required />
							</div>
							<div>
								<Label>顧客ID</Label>
								<Input name='clientId' defaultValue={deal.clientId} required />
							</div>
							<div>
								<Label>金額</Label>
								<Input
									name='amount'
									type='number'
									min='0'
									step='1'
									defaultValue={deal.amount}
									required
								/>
							</div>
							<div>
								<Label>パイプライン</Label>
								<Input
									name='pipeline'
									defaultValue={activePipeline?.id ?? deal.pipeline}
									required
								/>
							</div>
							<div>
								<Label>ステージ</Label>
								{stages.length ? (
									<Select name='stage' defaultValue={deal.stage}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{stages.map(stage => (
												<SelectItem key={stage.id} value={stage.id}>
													{stage.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : (
									<Input name='stage' defaultValue={deal.stage} required />
								)}
							</div>
							<div className='md:col-span-2'>
								<Label>担当</Label>
								<Input name='ownerName' defaultValue={deal.ownerName ?? ''} />
							</div>
							<div className='md:col-span-2'>
								<Label>メモ</Label>
								<Textarea name='memo' rows={8} defaultValue={deal.memo ?? ''} />
							</div>
						</CardContent>
					</Card>

					<div className='space-y-4'>
						<Card>
							<CardHeader>
								<CardTitle>サマリー</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3 text-sm'>
								<div className='flex justify-between gap-3'>
									<span className='text-muted-foreground'>金額</span>
									<span className='font-semibold'>
										{yen.format(Number(deal.amount || 0))}
									</span>
								</div>
								<div className='flex justify-between gap-3'>
									<span className='text-muted-foreground'>更新日時</span>
									<span>{formatDateTime(deal.updatedAt)}</span>
								</div>
								<div className='flex justify-between gap-3'>
									<span className='text-muted-foreground'>HubSpot ID</span>
									<span>{deal.providerPrimaryId ?? '未同期'}</span>
								</div>
								<Button type='submit' className='w-full'>
									保存
								</Button>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>顧客</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3'>
								<Button variant='outline' className='w-full' asChild>
									<Link
										href={
											`${mp}/${tenant}/library/clients/${deal.clientId}` as Route
										}
									>
										顧客詳細を開く
									</Link>
								</Button>
							</CardContent>
						</Card>
					</div>
				</form>
			</MainLayout>
		</V1Layout>
	)
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
