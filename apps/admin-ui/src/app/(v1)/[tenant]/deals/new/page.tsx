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
import { createDealAction, fetchPipelinesAction } from '../action'

export default async function NewDealPage({
	params: { tenant },
	searchParams: { clientId, clientName },
}: {
	params: { tenant: string }
	searchParams: { clientId?: string; clientName?: string }
}) {
	const pipelinesResult = await fetchPipelinesAction(tenant)
	const pipelines = pipelinesResult.data ?? []
	const pipeline = pipelines[0]
	const sortedStages = [...(pipeline?.stages ?? [])].sort(
		(a, b) => a.displayOrder - b.displayOrder,
	)
	const firstStage = sortedStages[0]
	const submit = createDealAction.bind(null, tenant)
	const mp = getServerModePrefix(tenant)

	return (
		<V1Layout current='deals' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<h1 className='text-2xl font-semibold'>案件作成</h1>
					<Button variant='outline' asChild>
						<Link href={`${mp}/${tenant}/deals` as Route}>一覧へ戻る</Link>
					</Button>
				</div>
				<form action={submit} className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader>
							<CardTitle>案件情報</CardTitle>
						</CardHeader>
						<CardContent className='grid gap-4 md:grid-cols-2'>
							<div className='md:col-span-2'>
								<Label>案件名</Label>
								<Input
									name='name'
									defaultValue={clientName ? `${clientName} 案件` : ''}
									required
								/>
							</div>
							<div>
								<Label>顧客ID</Label>
								<Input name='clientId' defaultValue={clientId ?? ''} required />
							</div>
							<div>
								<Label>金額</Label>
								<Input
									name='amount'
									type='number'
									min='0'
									step='1'
									defaultValue='0'
									required
								/>
							</div>
							<div>
								<Label>パイプライン</Label>
								{pipelines.length ? (
									<Select name='pipeline' defaultValue={pipeline?.id}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{pipelines.map(item => (
												<SelectItem key={item.id} value={item.id}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : (
									<Input name='pipeline' defaultValue='default' required />
								)}
							</div>
							<div>
								<Label>ステージ</Label>
								{pipeline?.stages.length ? (
									<Select name='stage' defaultValue={firstStage?.id}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{sortedStages.map(stage => (
												<SelectItem key={stage.id} value={stage.id}>
													{stage.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : (
									<Input name='stage' defaultValue='new' required />
								)}
							</div>
							<div className='md:col-span-2'>
								<Label>担当</Label>
								<Input name='ownerName' />
							</div>
							<div className='md:col-span-2'>
								<Label>メモ</Label>
								<Textarea name='memo' rows={8} />
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>保存</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<p className='text-sm text-muted-foreground'>
								作成した案件はローカルのCRM案件として保存されます。外部CRMへの同期は既存Webhook/連携状態に依存します。
							</p>
							<Button type='submit' className='w-full'>
								作成
							</Button>
						</CardContent>
					</Card>
				</form>
			</MainLayout>
		</V1Layout>
	)
}
