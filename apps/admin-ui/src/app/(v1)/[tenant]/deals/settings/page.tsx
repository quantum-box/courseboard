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
import { fetchPipelinesAction } from '../action'

export default async function DealSettingsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const pipelinesResult = await fetchPipelinesAction(tenant)
	const pipelines = pipelinesResult.data ?? []
	const mp = getServerModePrefix(tenant)

	return (
		<V1Layout current='deals' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>パイプライン設定</h1>
						<p className='text-sm text-muted-foreground'>
							既存CRMのpipeline/stage定義を参照します
						</p>
					</div>
					<Button variant='outline' asChild>
						<Link href={`${mp}/${tenant}/deals` as Route}>案件一覧へ戻る</Link>
					</Button>
				</div>

				{pipelinesResult.message ? (
					<Card>
						<CardContent className='pt-6 text-sm text-muted-foreground'>
							{pipelinesResult.message}
						</CardContent>
					</Card>
				) : null}

				<Card>
					<CardHeader>
						<CardTitle>ステージ</CardTitle>
					</CardHeader>
					<CardContent className='space-y-4'>
						<div className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
							ステージ追加・並び替え用の安全な内部APIは未提供です。現在は既存CRM
							providerから読み取れる定義の表示まで対応しています。
						</div>
						{pipelines.length === 0 ? (
							<div className='rounded-md border p-6 text-center text-sm text-muted-foreground'>
								パイプラインは取得できませんでした。
							</div>
						) : null}
						{pipelines.map(pipeline => (
							<div key={pipeline.id} className='space-y-3'>
								<div className='flex items-center justify-between gap-3'>
									<div>
										<h2 className='font-semibold'>{pipeline.label}</h2>
										<p className='text-xs text-muted-foreground'>
											{pipeline.id}
										</p>
									</div>
									<Badge variant='outline'>order {pipeline.displayOrder}</Badge>
								</div>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>順序</TableHead>
											<TableHead>ステージ</TableHead>
											<TableHead>ID</TableHead>
											<TableHead>更新日時</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{[...pipeline.stages]
											.sort((a, b) => a.displayOrder - b.displayOrder)
											.map(stage => (
												<TableRow key={stage.id}>
													<TableCell>{stage.displayOrder}</TableCell>
													<TableCell className='font-medium'>
														{stage.label}
													</TableCell>
													<TableCell>{stage.id}</TableCell>
													<TableCell>{stage.updatedAt}</TableCell>
												</TableRow>
											))}
									</TableBody>
								</Table>
							</div>
						))}
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}
