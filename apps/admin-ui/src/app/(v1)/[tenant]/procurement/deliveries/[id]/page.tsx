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
import { Separator } from 'components/ui/separator'
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
import { notFound } from 'next/navigation'
import {
	getDeliveryDetail,
	listReceivingDiscrepancies,
	type DeliveryDetail,
	type ReceivingDiscrepancy,
} from '../../_lib/erp-api'
import { CommitReceivingForm } from '../_components/commit-receiving-form'
import { DiscrepancyResolutionForm } from '../_components/discrepancy-resolution-form'
import { DeliveryStatusBadge } from '../_components/delivery-status-badge'
import {
	commitDeliveryReceivingAction,
	commitDeliveryReceivingManualAction,
	resolveReceivingDiscrepancyAction,
} from '../actions'

export const metadata = {
	title: '納品書詳細 | TACHYON Field',
	description: '納品書の OCR 結果と検収状況を確認します。',
}

function formatDateTime(value: string | null): string {
	if (!value) {
		return '未設定'
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

function formatConfidence(value: number | null): string {
	if (value === null) {
		return '—'
	}

	return `${Math.round(value * 100)}%`
}

function formatDiscrepancyKind(value: string): string {
	switch (value) {
		case 'QTY_EXCESS':
		case 'qty_excess':
			return '過入荷'
		case 'QTY_SHORT':
		case 'qty_short':
			return '不足'
		case 'SKU_UNKNOWN':
		case 'sku_unknown':
			return 'SKU未特定'
		default:
			return '数量差異'
	}
}

function getReceivingActionMessage(delivery: DeliveryDetail): string {
	if (delivery.status === 'received') {
		return '検収済みです。差異がある場合は下の差異対応から解消してください。'
	}
	if (delivery.status === 'processing') {
		return 'OCR 処理中です。完了後に検収確定できます。'
	}
	if (delivery.status === 'failed') {
		return 'OCR または連携処理が失敗しています。納品書を再登録するか連携設定を確認してください。'
	}
	if (delivery.ocrLines.length === 0) {
		return 'OCR 行がないため検収確定できません。納品書の内容を確認してください。'
	}

	return 'OCR 結果を検収データとして確定し、在庫反映へ進めます。'
}

function summarizeOpenDiscrepancies(items: ReceivingDiscrepancy[]): string {
	const openCount = items.filter(item => item.status === 'open').length
	if (openCount === 0) {
		return '未解決の差異はありません。'
	}

	return `未解決の差異が ${openCount} 件あります。解消方針とメモを記録してください。`
}

export default async function ProcurementDeliveryDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string; id: string }>
	searchParams: Promise<{ flash?: string }>
}) {
	const { tenant, id } = await params
	const { flash } = await searchParams
	const prefix = getServerModePrefix(tenant)
	let deliveryError: string | null = null
	const deliveryResult = await getDeliveryDetail(tenant, id).catch(error => {
		console.error('Failed to load procurement delivery detail:', error)
		deliveryError =
			error instanceof Error
				? error.message
				: '納品書詳細を取得できませんでした'
		return null
	})
	const discrepanciesResult = await listReceivingDiscrepancies(tenant).catch(
		error => {
			console.error('Failed to load receiving discrepancies:', error)
			return null
		},
	)
	const item = deliveryResult?.item ?? null

	if (deliveryResult && !item) {
		notFound()
	}

	const delivery = item
	const receivingLines =
		delivery?.ocrLines.map(line => ({
			sku: line.skuCode,
			quantity: line.quantity,
		})) ?? []
	const discrepancies =
		discrepanciesResult?.items.filter(item => item.slipId === id) ?? []
	const openDiscrepancyCount = discrepancies.filter(
		item => item.status === 'open',
	).length
	const canCommit =
		delivery?.status === 'ocr_completed' && delivery.ocrLines.length > 0
	const manualCorrectionAction = commitDeliveryReceivingManualAction.bind(
		null,
		tenant,
		id,
	)

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
									納品書
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>
								{delivery?.documentName ?? '納品書詳細'}
							</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				{!delivery && (
					<Card>
						<CardHeader>
							<CardTitle>納品書詳細を取得できませんでした</CardTitle>
							<CardDescription>
								{deliveryError ??
									'連携設定を確認のうえ、しばらくしてから再度お試しください。'}
							</CardDescription>
						</CardHeader>
						<CardContent className='flex flex-wrap gap-2'>
							<Button variant='default' asChild>
								<Link
									href={
										`${prefix}/${tenant}/procurement/deliveries/${id}` as Route
									}
								>
									再試行
								</Link>
							</Button>
							<Button variant='outline' asChild>
								<Link
									href={`${prefix}/${tenant}/procurement/deliveries` as Route}
								>
									納品書一覧に戻る
								</Link>
							</Button>
						</CardContent>
					</Card>
				)}
				{delivery && (
					<>
						{flash === 'uploaded' && (
							<ToastClient
								title='OCR 結果を表示しました'
								description='REST API の OCR 応答を表示しています'
								variant='default'
							/>
						)}
						{flash === 'received' && (
							<ToastClient
								title='検収を確定しました'
								description='在庫一覧への反映を確認してください'
								variant='default'
							/>
						)}
						{flash === 'resolved' && (
							<ToastClient
								title='検収差異を解消しました'
								description='監査ログへ解消内容を記録しました'
								variant='default'
							/>
						)}

						<div className='space-y-4'>
							<Card>
								<CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
									<div>
										<CardTitle>納品書サマリー</CardTitle>
										<CardDescription>
											OCR 結果を確認し、問題なければ検収確定します。
										</CardDescription>
									</div>
									<div className='flex items-center gap-2'>
										<DeliveryStatusBadge status={delivery.status} />
									</div>
								</CardHeader>
								<CardContent className='space-y-6'>
									<div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
										<div>
											<p className='text-sm text-muted-foreground'>
												サプライヤー
											</p>
											<p className='font-medium'>{delivery.supplierName}</p>
										</div>
										<div>
											<p className='text-sm text-muted-foreground'>倉庫</p>
											<p className='font-medium'>{delivery.warehouseName}</p>
										</div>
										<div>
											<p className='text-sm text-muted-foreground'>
												アップロード日時
											</p>
											<p className='font-medium'>
												{formatDateTime(delivery.uploadedAt)}
											</p>
										</div>
										<div>
											<p className='text-sm text-muted-foreground'>
												検収確定日時
											</p>
											<p className='font-medium'>
												{formatDateTime(delivery.receivedAt)}
											</p>
										</div>
									</div>
									{delivery.note && (
										<>
											<Separator />
											<div>
												<p className='text-sm text-muted-foreground'>メモ</p>
												<p className='mt-1 text-sm'>{delivery.note}</p>
											</div>
										</>
									)}
									<Separator />
									<div className='grid gap-4 md:grid-cols-2'>
										<div className='space-y-1'>
											<p className='text-sm text-muted-foreground'>原本証憑</p>
											{delivery.documentUrl ? (
												<Button variant='outline' size='sm' asChild>
													<a
														href={delivery.documentUrl}
														target='_blank'
														rel='noreferrer'
													>
														原本を開く
													</a>
												</Button>
											) : (
												<p className='text-sm'>未保存</p>
											)}
										</div>
										<div className='space-y-1'>
											<p className='text-sm text-muted-foreground'>
												OCR 信頼度 / 証憑ハッシュ
											</p>
											<p className='font-medium'>
												{formatConfidence(delivery.confidence)}
											</p>
											<p className='break-all font-mono text-xs text-muted-foreground'>
												{delivery.originalSha256 ?? '—'}
											</p>
										</div>
									</div>
									{delivery.reviewRequired && (
										<div className='rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950'>
											<p className='text-sm font-medium'>手動確認が必要です</p>
											<ul className='mt-2 list-disc space-y-1 pl-5 text-sm'>
												{delivery.reviewReasons.length > 0 ? (
													delivery.reviewReasons.map(reason => (
														<li key={reason}>{reason}</li>
													))
												) : (
													<li>低信頼度または未確定項目があります</li>
												)}
											</ul>
										</div>
									)}
									<div className='flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between'>
										<div className='space-y-1'>
											<p className='text-sm font-medium'>
												OCR ライン {delivery.ocrLines.length} 件 / 数量合計{' '}
												{delivery.totalQuantity}
											</p>
											<p className='text-sm text-muted-foreground'>
												{getReceivingActionMessage(delivery)}
											</p>
										</div>
										<CommitReceivingForm
											action={commitDeliveryReceivingAction.bind(
												null,
												tenant,
												id,
												receivingLines,
											)}
											disabled={!canCommit}
										/>
									</div>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>OCR 結果</CardTitle>
									<CardDescription>
										抽出された SKU と数量を検収前に確認します。
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className='grid gap-3 md:hidden'>
										{delivery.ocrLines.length === 0 ? (
											<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
												OCR 結果はまだありません
											</div>
										) : (
											delivery.ocrLines.map(line => (
												<div
													key={line.id}
													className='rounded-lg border bg-background p-4'
												>
													<div className='flex items-start justify-between gap-3'>
														<div className='min-w-0'>
															<p className='break-all font-mono text-sm font-medium'>
																{line.skuCode}
															</p>
															<p className='mt-1 text-sm'>{line.productName}</p>
														</div>
														<span className='rounded-md bg-muted px-3 py-1 text-base font-semibold tabular-nums'>
															{line.quantity}
														</span>
													</div>
													<div className='mt-4 grid grid-cols-2 gap-3 text-sm'>
														<div>
															<p className='text-xs text-muted-foreground'>
																単位
															</p>
															<p>{line.unit}</p>
														</div>
														<div>
															<p className='text-xs text-muted-foreground'>
																信頼度
															</p>
															<p>{formatConfidence(line.confidence)}</p>
														</div>
														<div className='col-span-2'>
															<p className='text-xs text-muted-foreground'>
																倉庫
															</p>
															<p>{line.warehouseName ?? '—'}</p>
														</div>
													</div>
													<p className='mt-3 text-sm'>
														{line.reviewRequired ? (
															<span className='text-amber-700'>要補正</span>
														) : (
															<span className='text-muted-foreground'>
																確認済
															</span>
														)}
													</p>
												</div>
											))
										)}
									</div>
									<div className='hidden overflow-x-auto md:block'>
										<Table className='min-w-[760px]'>
											<TableHeader>
												<TableRow>
													<TableHead>SKU</TableHead>
													<TableHead>商品名</TableHead>
													<TableHead className='text-right'>数量</TableHead>
													<TableHead>単位</TableHead>
													<TableHead className='hidden md:table-cell'>
														倉庫
													</TableHead>
													<TableHead className='hidden lg:table-cell text-right'>
														信頼度
													</TableHead>
													<TableHead>確認</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{delivery.ocrLines.length === 0 ? (
													<TableRow>
														<TableCell
															colSpan={7}
															className='py-8 text-center text-muted-foreground'
														>
															OCR 結果はまだありません
														</TableCell>
													</TableRow>
												) : (
													delivery.ocrLines.map(line => (
														<TableRow key={line.id}>
															<TableCell className='font-mono text-xs'>
																{line.skuCode}
															</TableCell>
															<TableCell>{line.productName}</TableCell>
															<TableCell className='text-right tabular-nums'>
																{line.quantity}
															</TableCell>
															<TableCell>{line.unit}</TableCell>
															<TableCell className='hidden md:table-cell'>
																{line.warehouseName ?? '—'}
															</TableCell>
															<TableCell className='hidden lg:table-cell text-right text-muted-foreground'>
																{formatConfidence(line.confidence)}
															</TableCell>
															<TableCell>
																{line.reviewRequired ? (
																	<span className='text-amber-700 text-sm'>
																		要補正
																	</span>
																) : (
																	<span className='text-muted-foreground text-sm'>
																		確認済
																	</span>
																)}
															</TableCell>
														</TableRow>
													))
												)}
											</TableBody>
										</Table>
									</div>
								</CardContent>
							</Card>

							{delivery.reviewRequired && delivery.status !== 'received' && (
								<Card>
									<CardHeader>
										<CardTitle>手動補正</CardTitle>
										<CardDescription>
											OCR 候補の SKU と数量を補正して検収確定します。
										</CardDescription>
									</CardHeader>
									<CardContent>
										<form action={manualCorrectionAction} className='space-y-4'>
											<div className='grid gap-3 md:hidden'>
												{delivery.ocrLines.map(line => (
													<div
														key={`manual-card-${line.id}`}
														className='rounded-lg border bg-background p-4'
													>
														<p className='break-all font-mono text-sm font-medium'>
															{line.vendorSkuText ?? line.skuCode}
														</p>
														<div className='mt-3 grid gap-3'>
															<label className='grid gap-2'>
																<span className='text-xs font-medium text-muted-foreground'>
																	補正後 SKU
																</span>
																<input
																	name='sku'
																	defaultValue={line.skuCode}
																	className='h-11 w-full rounded-md border bg-background px-3 py-1 font-mono text-base'
																/>
															</label>
															<label className='grid gap-2'>
																<span className='text-xs font-medium text-muted-foreground'>
																	補正後数量
																</span>
																<input
																	name='quantity'
																	type='number'
																	min='1'
																	inputMode='numeric'
																	defaultValue={line.quantity}
																	className='h-11 w-full rounded-md border bg-background px-3 py-1 text-right text-base tabular-nums'
																/>
															</label>
														</div>
														<p className='mt-3 text-xs text-muted-foreground'>
															信頼度 {formatConfidence(line.confidence)}
														</p>
													</div>
												))}
											</div>
											<div className='hidden overflow-x-auto md:block'>
												<Table className='min-w-[680px]'>
													<TableHeader>
														<TableRow>
															<TableHead>OCR SKU</TableHead>
															<TableHead>補正後 SKU</TableHead>
															<TableHead className='text-right'>
																補正後数量
															</TableHead>
															<TableHead className='hidden md:table-cell'>
																信頼度
															</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{delivery.ocrLines.map(line => (
															<TableRow key={`manual-${line.id}`}>
																<TableCell className='font-mono text-xs'>
																	{line.vendorSkuText ?? line.skuCode}
																</TableCell>
																<TableCell>
																	<input
																		name='sku'
																		defaultValue={line.skuCode}
																		className='h-9 w-full rounded-md border bg-background px-3 py-1 text-sm font-mono'
																	/>
																</TableCell>
																<TableCell>
																	<input
																		name='quantity'
																		type='number'
																		min='1'
																		defaultValue={line.quantity}
																		className='ml-auto h-9 w-28 rounded-md border bg-background px-3 py-1 text-right text-sm tabular-nums'
																	/>
																</TableCell>
																<TableCell className='hidden md:table-cell text-muted-foreground'>
																	{formatConfidence(line.confidence)}
																</TableCell>
															</TableRow>
														))}
													</TableBody>
												</Table>
											</div>
											<div className='flex justify-end'>
												<Button type='submit' className='w-full sm:w-auto'>
													補正して検収確定
												</Button>
											</div>
										</form>
									</CardContent>
								</Card>
							)}

							<Card>
								<CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
									<div>
										<CardTitle>検収差異</CardTitle>
										<CardDescription>
											{discrepanciesResult
												? summarizeOpenDiscrepancies(discrepancies)
												: '検収差異を取得できませんでした。権限または連携設定を確認してください。'}
										</CardDescription>
									</div>
									<div className='rounded-md border px-3 py-2 text-sm'>
										<span className='text-muted-foreground'>未解決 </span>
										<span className='font-semibold tabular-nums'>
											{openDiscrepancyCount}
										</span>
									</div>
								</CardHeader>
								<CardContent>
									{discrepancies.length === 0 ? (
										<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
											この納品書に紐づく検収差異はありません。数量差異がある場合は検収確定後に表示されます。
										</div>
									) : (
										<>
											<div className='grid gap-3 md:hidden'>
												{discrepancies.map(discrepancy => (
													<div
														key={discrepancy.id}
														className='rounded-lg border bg-background p-4'
													>
														<div className='flex items-start justify-between gap-3'>
															<div className='min-w-0'>
																<p className='break-all font-mono text-sm font-medium'>
																	{discrepancy.sku}
																</p>
																<p className='mt-1 text-sm'>
																	{formatDiscrepancyKind(discrepancy.kind)}
																</p>
															</div>
															{discrepancy.status === 'resolved' ? (
																<span className='text-sm text-emerald-700'>
																	解消済み
																</span>
															) : (
																<span className='text-sm text-amber-700'>
																	未解決
																</span>
															)}
														</div>
														<div className='mt-4 grid grid-cols-2 gap-3 text-sm'>
															<div>
																<p className='text-xs text-muted-foreground'>
																	予定
																</p>
																<p className='font-medium tabular-nums'>
																	{discrepancy.expectedQuantity}
																</p>
															</div>
															<div>
																<p className='text-xs text-muted-foreground'>
																	実績
																</p>
																<p className='font-medium tabular-nums'>
																	{discrepancy.actualQuantity}
																</p>
															</div>
														</div>
														{discrepancy.resolutionNote && (
															<p className='mt-3 text-xs text-muted-foreground'>
																{discrepancy.resolutionNote}
															</p>
														)}
														<div className='mt-4'>
															<DiscrepancyResolutionForm
																action={resolveReceivingDiscrepancyAction.bind(
																	null,
																	tenant,
																	id,
																	discrepancy.id,
																)}
																disabled={discrepancy.status === 'resolved'}
															/>
														</div>
													</div>
												))}
											</div>
											<div className='hidden overflow-x-auto md:block'>
												<Table className='min-w-[900px]'>
													<TableHeader>
														<TableRow>
															<TableHead>SKU</TableHead>
															<TableHead>種別</TableHead>
															<TableHead className='text-right'>予定</TableHead>
															<TableHead className='text-right'>実績</TableHead>
															<TableHead>状態</TableHead>
															<TableHead className='min-w-[360px]'>
																対応
															</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{discrepancies.map(discrepancy => (
															<TableRow key={discrepancy.id}>
																<TableCell className='font-mono text-xs'>
																	{discrepancy.sku}
																</TableCell>
																<TableCell>
																	{formatDiscrepancyKind(discrepancy.kind)}
																</TableCell>
																<TableCell className='text-right tabular-nums'>
																	{discrepancy.expectedQuantity}
																</TableCell>
																<TableCell className='text-right tabular-nums'>
																	{discrepancy.actualQuantity}
																</TableCell>
																<TableCell>
																	{discrepancy.status === 'resolved' ? (
																		<span className='text-sm text-emerald-700'>
																			解消済み
																		</span>
																	) : (
																		<span className='text-sm text-amber-700'>
																			未解決
																		</span>
																	)}
																	{discrepancy.resolutionNote && (
																		<p className='mt-1 text-xs text-muted-foreground'>
																			{discrepancy.resolutionNote}
																		</p>
																	)}
																</TableCell>
																<TableCell>
																	<DiscrepancyResolutionForm
																		action={resolveReceivingDiscrepancyAction.bind(
																			null,
																			tenant,
																			id,
																			discrepancy.id,
																		)}
																		disabled={discrepancy.status === 'resolved'}
																	/>
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

							<Card>
								<CardHeader>
									<CardTitle>検収結果</CardTitle>
									<CardDescription>
										検収確定後に在庫へ反映された数量を表示します。
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className='grid gap-3 md:hidden'>
										{delivery.receivedLines.length === 0 ? (
											<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
												まだ検収確定されていません
											</div>
										) : (
											delivery.receivedLines.map(line => (
												<div
													key={line.id}
													className='rounded-lg border bg-background p-4'
												>
													<div className='flex items-start justify-between gap-3'>
														<div className='min-w-0'>
															<p className='break-all font-mono text-sm font-medium'>
																{line.skuCode}
															</p>
															<p className='mt-1 text-sm'>{line.productName}</p>
														</div>
														<span className='rounded-md bg-muted px-3 py-1 text-base font-semibold tabular-nums'>
															{line.quantity}
														</span>
													</div>
													<div className='mt-4 grid grid-cols-2 gap-3 text-sm'>
														<div>
															<p className='text-xs text-muted-foreground'>
																ロット
															</p>
															<p className='font-mono text-xs'>
																{line.lotNo ?? '—'}
															</p>
														</div>
														<div>
															<p className='text-xs text-muted-foreground'>
																期限
															</p>
															<p>{formatDateTime(line.expiresAt)}</p>
														</div>
														<div>
															<p className='text-xs text-muted-foreground'>
																単位
															</p>
															<p>{line.unit}</p>
														</div>
													</div>
												</div>
											))
										)}
									</div>
									<div className='hidden overflow-x-auto md:block'>
										<Table className='min-w-[760px]'>
											<TableHeader>
												<TableRow>
													<TableHead>SKU</TableHead>
													<TableHead>商品名</TableHead>
													<TableHead>ロット</TableHead>
													<TableHead>期限</TableHead>
													<TableHead className='text-right'>入庫数量</TableHead>
													<TableHead>単位</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{delivery.receivedLines.length === 0 ? (
													<TableRow>
														<TableCell
															colSpan={6}
															className='py-8 text-center text-muted-foreground'
														>
															まだ検収確定されていません
														</TableCell>
													</TableRow>
												) : (
													delivery.receivedLines.map(line => (
														<TableRow key={line.id}>
															<TableCell className='font-mono text-xs'>
																{line.skuCode}
															</TableCell>
															<TableCell>{line.productName}</TableCell>
															<TableCell className='font-mono text-xs'>
																{line.lotNo ?? '—'}
															</TableCell>
															<TableCell>
																{formatDateTime(line.expiresAt)}
															</TableCell>
															<TableCell className='text-right tabular-nums'>
																{line.quantity}
															</TableCell>
															<TableCell>{line.unit}</TableCell>
														</TableRow>
													))
												)}
											</TableBody>
										</Table>
									</div>
								</CardContent>
							</Card>
						</div>
					</>
				)}
			</MainLayout>
		</V1Layout>
	)
}
