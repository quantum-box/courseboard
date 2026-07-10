import { ToastClient } from 'components/toast-client'
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
import { SearchIcon, SlidersHorizontalIcon } from 'lucide-react'
import { listDeliveries, type DeliveryStatus } from '../_lib/erp-api'
import { DeliveryStatusBadge } from './_components/delivery-status-badge'
import { UploadDeliveryForm } from './_components/upload-delivery-form'
import { uploadDeliveryAction } from './actions'

export const metadata = {
	title: '入荷管理 | TACHYON Field',
	description: '調達納品書のアップロード、検索、検収状況確認を行います。',
}

const STATUS_OPTIONS: Array<{ value: DeliveryStatus | 'all'; label: string }> =
	[
		{ value: 'all', label: 'すべて' },
		{ value: 'ocr_completed', label: 'OCR完了' },
		{ value: 'processing', label: '処理中' },
		{ value: 'received', label: '検収済み' },
		{ value: 'failed', label: '失敗' },
		{ value: 'draft', label: '下書き' },
	]

function formatDateTime(value: string | null): string {
	if (!value) {
		return '未検収'
	}

	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value
	}

	try {
		return date.toLocaleString('ja-JP', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return date.toISOString()
	}
}

function formatDate(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value
	}

	return date.toISOString().slice(0, 10)
}

function normalizeStatus(value: string | undefined): DeliveryStatus | 'all' {
	return STATUS_OPTIONS.some(option => option.value === value)
		? (value as DeliveryStatus | 'all')
		: 'all'
}

function includesText(value: string | null, query: string): boolean {
	return value?.toLowerCase().includes(query) ?? false
}

export default async function ProcurementDeliveriesPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>
	searchParams: Promise<{
		flash?: string
		q?: string
		status?: string
		date?: string
	}>
}) {
	const { tenant } = await params
	const { flash, q, status, date } = await searchParams
	const prefix = getServerModePrefix(tenant)
	const query = q?.trim().toLowerCase() ?? ''
	const selectedStatus = normalizeStatus(status)
	const selectedDate = date?.trim() ?? ''
	let deliveriesError: string | null = null
	const deliveriesResult = await listDeliveries(tenant).catch(error => {
		console.error('Failed to load procurement deliveries:', error)
		deliveriesError =
			error instanceof Error
				? error.message
				: '納品書一覧を取得できませんでした'
		return null
	})
	const items = deliveriesResult?.items ?? []
	const filteredItems = items.filter(item => {
		const matchesQuery =
			query.length === 0 ||
			includesText(item.documentName, query) ||
			includesText(item.supplierName, query) ||
			includesText(item.warehouseName, query) ||
			includesText(item.note, query) ||
			item.id.toLowerCase().includes(query)
		const matchesStatus =
			selectedStatus === 'all' || item.status === selectedStatus
		const matchesDate =
			selectedDate.length === 0 || formatDate(item.uploadedAt) === selectedDate

		return matchesQuery && matchesStatus && matchesDate
	})
	const pendingCount = items.filter(
		item => item.status === 'ocr_completed',
	).length
	const processingCount = items.filter(
		item => item.status === 'processing',
	).length
	const failedCount = items.filter(item => item.status === 'failed').length
	const receivedCount = items.filter(item => item.status === 'received').length

	return (
		<V1Layout
			current='procurement'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link
									href={`${prefix}/${tenant}/procurement/deliveries` as Route}
								>
									調達
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>納品書</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				{flash === 'uploaded' && (
					<ToastClient
						title='納品書を登録しました'
						description='OCR 結果の確認に進めます'
						variant='default'
					/>
				)}

				<div className='space-y-4'>
					<HelpPanel
						storageKey='procurement-deliveries'
						title='入荷管理フロー'
						summary='upload -> OCR -> 検収確定 -> 差異解消 -> 在庫反映'
						sections={[
							{
								title: 'この画面で行うこと',
								content:
									'納品書ファイルをアップロードし、OCR で抽出した SKU / 数量を一覧から検索して確認します。',
							},
							{
								title: '推奨フロー',
								content:
									'1. 納品書をアップロード\n2. 一覧で未確定を絞り込む\n3. 詳細画面で OCR 結果を確認\n4. 検収確定と差異解消を行う\n5. 在庫一覧で反映を確認',
							},
							{
								title: 'MVP の前提',
								content:
									'OCR と検収は REST API の応答を表示します。連携障害時はエラーを表示し、正常データとして扱いません。',
							},
						]}
					/>

					<UploadDeliveryForm
						action={uploadDeliveryAction.bind(null, tenant)}
					/>

					<div className='grid gap-3 md:grid-cols-4'>
						<div className='rounded-lg border bg-background p-4'>
							<p className='text-sm text-muted-foreground'>検収待ち</p>
							<p className='mt-2 text-2xl font-semibold tabular-nums'>
								{pendingCount}
							</p>
						</div>
						<div className='rounded-lg border bg-background p-4'>
							<p className='text-sm text-muted-foreground'>処理中</p>
							<p className='mt-2 text-2xl font-semibold tabular-nums'>
								{processingCount}
							</p>
						</div>
						<div className='rounded-lg border bg-background p-4'>
							<p className='text-sm text-muted-foreground'>要確認</p>
							<p className='mt-2 text-2xl font-semibold tabular-nums text-destructive'>
								{failedCount}
							</p>
						</div>
						<div className='rounded-lg border bg-background p-4'>
							<p className='text-sm text-muted-foreground'>検収済み</p>
							<p className='mt-2 text-2xl font-semibold tabular-nums'>
								{receivedCount}
							</p>
						</div>
					</div>

					<Card>
						<CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
							<div>
								<CardTitle>入荷一覧</CardTitle>
								<CardDescription>
									アップロード済みの納品書と OCR / 検収ステータスを検索します。
								</CardDescription>
							</div>
						</CardHeader>
						<CardContent className='space-y-4'>
							<form className='grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto]'>
								<label className='space-y-1'>
									<span className='text-xs font-medium text-muted-foreground'>
										検索
									</span>
									<div className='relative'>
										<SearchIcon className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
										<input
											name='q'
											defaultValue={q ?? ''}
											placeholder='納品書・サプライヤー・倉庫'
											className='h-11 w-full rounded-md border bg-background pl-9 pr-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm'
										/>
									</div>
								</label>
								<label className='space-y-1'>
									<span className='text-xs font-medium text-muted-foreground'>
										状態
									</span>
									<select
										name='status'
										defaultValue={selectedStatus}
										className='h-11 w-full rounded-md border bg-background px-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm'
									>
										{STATUS_OPTIONS.map(option => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</label>
								<label className='space-y-1'>
									<span className='text-xs font-medium text-muted-foreground'>
										アップロード日
									</span>
									<input
										name='date'
										type='date'
										defaultValue={selectedDate}
										className='h-11 w-full rounded-md border bg-background px-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm'
									/>
								</label>
								<div className='flex flex-col gap-2 sm:flex-row sm:items-end'>
									<Button type='submit' className='h-11 w-full gap-2 sm:w-auto'>
										<SlidersHorizontalIcon className='h-4 w-4' />
										絞り込み
									</Button>
									<Button
										variant='outline'
										className='h-11 w-full sm:w-auto'
										asChild
									>
										<Link
											href={
												`${prefix}/${tenant}/procurement/deliveries` as Route
											}
										>
											解除
										</Link>
									</Button>
								</div>
							</form>

							{!deliveriesResult ? (
								<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
									<p className='font-medium text-foreground'>
										納品書一覧を取得できませんでした
									</p>
									<p className='mt-2'>
										{deliveriesError ??
											'連携設定を確認のうえ、しばらくしてから再度お試しください。'}
									</p>
									<div className='mt-4'>
										<Button variant='outline' size='sm' asChild>
											<Link
												href={
													`${prefix}/${tenant}/procurement/deliveries` as Route
												}
											>
												再試行
											</Link>
										</Button>
									</div>
								</div>
							) : items.length === 0 ? (
								<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
									納品書はまだありません。上のフォームから最初の納品書を登録してください。
								</div>
							) : filteredItems.length === 0 ? (
								<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
									条件に一致する入荷はありません。検索条件を変更してください。
								</div>
							) : (
								<>
									<div className='grid gap-3 md:hidden'>
										{filteredItems.map(item => (
											<div
												key={item.id}
												className='rounded-lg border bg-background p-4'
											>
												<div className='flex items-start justify-between gap-3'>
													<div className='min-w-0 space-y-1'>
														<p className='truncate font-medium'>
															{item.documentName}
														</p>
														<p className='text-xs text-muted-foreground'>
															{item.supplierName} / {item.warehouseName}
														</p>
													</div>
													<DeliveryStatusBadge status={item.status} />
												</div>
												<div className='mt-3 grid grid-cols-2 gap-3 text-sm'>
													<div>
														<p className='text-xs text-muted-foreground'>
															行数
														</p>
														<p className='font-medium tabular-nums'>
															{item.lineCount}
														</p>
													</div>
													<div>
														<p className='text-xs text-muted-foreground'>
															数量合計
														</p>
														<p className='font-medium tabular-nums'>
															{item.totalQuantity}
														</p>
													</div>
													<div className='col-span-2'>
														<p className='text-xs text-muted-foreground'>OCR</p>
														<p className='font-medium'>{item.ocrStatus}</p>
													</div>
													<div className='col-span-2'>
														<p className='text-xs text-muted-foreground'>
															アップロード日時
														</p>
														<p className='font-medium'>
															{formatDateTime(item.uploadedAt)}
														</p>
													</div>
												</div>
												<Button
													variant='outline'
													className='mt-4 h-11 w-full'
													asChild
												>
													<Link
														href={
															`${prefix}/${tenant}/procurement/deliveries/${item.id}` as Route
														}
													>
														詳細
													</Link>
												</Button>
											</div>
										))}
									</div>
									<div className='hidden overflow-x-auto md:block'>
										<Table className='min-w-[880px]'>
											<TableHeader>
												<TableRow>
													<TableHead>納品書</TableHead>
													<TableHead>サプライヤー</TableHead>
													<TableHead>OCR / 検収</TableHead>
													<TableHead className='text-right'>行数</TableHead>
													<TableHead className='text-right'>数量合計</TableHead>
													<TableHead>アップロード日時</TableHead>
													<TableHead className='w-[120px]' />
												</TableRow>
											</TableHeader>
											<TableBody>
												{filteredItems.map(item => (
													<TableRow key={item.id}>
														<TableCell>
															<div className='space-y-1'>
																<p className='font-medium'>
																	{item.documentName}
																</p>
																<p className='text-xs text-muted-foreground'>
																	{item.warehouseName}
																</p>
															</div>
														</TableCell>
														<TableCell>{item.supplierName}</TableCell>
														<TableCell>
															<div className='space-y-1'>
																<DeliveryStatusBadge status={item.status} />
																<p className='text-xs text-muted-foreground'>
																	OCR: {item.ocrStatus}
																</p>
																{item.status === 'ocr_completed' && (
																	<p className='text-xs text-sky-700'>
																		詳細で検収確定
																	</p>
																)}
																{item.status === 'failed' && (
																	<p className='text-xs text-destructive'>
																		詳細でエラー内容を確認
																	</p>
																)}
															</div>
														</TableCell>
														<TableCell className='text-right tabular-nums'>
															{item.lineCount}
														</TableCell>
														<TableCell className='text-right tabular-nums'>
															{item.totalQuantity}
														</TableCell>
														<TableCell className='text-sm text-muted-foreground'>
															{formatDateTime(item.uploadedAt)}
														</TableCell>
														<TableCell className='text-right'>
															<Button variant='outline' size='sm' asChild>
																<Link
																	href={
																		`${prefix}/${tenant}/procurement/deliveries/${item.id}` as Route
																	}
																>
																	詳細
																</Link>
															</Button>
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								</>
							)}
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
