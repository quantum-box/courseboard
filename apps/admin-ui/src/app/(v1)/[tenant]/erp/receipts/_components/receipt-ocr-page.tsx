'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { getBackendBaseUrl } from 'lib/backendUrl'
import {
	CameraIcon,
	FileTextIcon,
	Loader2Icon,
	RefreshCwIcon,
	UploadIcon,
} from 'lucide-react'
import {
	type ChangeEvent,
	type DragEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

type ReceiptUpload = {
	id: string
	tenantId: string
	receiptType: string
	uploadedBy: string
	fileUrl: string
	fileName: string | null
	rawOcrText: string | null
	extractedData: Record<string, unknown> | null
	status: string
	errorMessage: string | null
	createdAt: string
	updatedAt: string
}

const BACKEND_URL = getBackendBaseUrl()

function statusBadge(status: string) {
	switch (status) {
		case 'done':
			return <Badge variant='secondary'>完了</Badge>
		case 'processing':
			return <Badge variant='outline'>処理中</Badge>
		case 'error':
			return <Badge variant='destructive'>エラー</Badge>
		default:
			return <Badge variant='outline'>待機中</Badge>
	}
}

function receiptTypeLabel(type: string) {
	return type === 'sales' ? '売上' : '仕入'
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(new Date(value))
}

function formatAmount(value: unknown) {
	const amount = Number(value)
	if (!Number.isFinite(amount)) return String(value)
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0,
	}).format(amount)
}

function ExtractedDataPreview({
	data,
}: {
	data: Record<string, unknown> | null
}) {
	if (!data) return <span className='text-muted-foreground'>-</span>

	const items = (data.items as Array<Record<string, unknown>>) ?? []
	const total = data.total as number | undefined
	const date = data.date ? String(data.date) : null
	const counterparty = data.store_name ?? data.supplier_name
	const counterpartyLabel = data.store_name ? '店舗' : '仕入先'
	const paymentMethod = data.payment_method

	return (
		<div className='space-y-2 text-sm'>
			{date && (
				<div>
					<span className='font-medium'>日付:</span> {date}
				</div>
			)}
			{counterparty != null && (
				<div>
					<span className='font-medium'>{counterpartyLabel}:</span>{' '}
					{String(counterparty)}
				</div>
			)}
			{items.length > 0 && (
				<div>
					<span className='font-medium'>明細 ({items.length}件):</span>
					<ul className='ml-4 mt-1 list-disc'>
						{items.slice(0, 5).map((item, index) => (
							<li key={`item-${item.name}-${index}`}>
								{String(item.name)} x{String(item.quantity ?? 1)} ={' '}
								{formatAmount(item.amount)}
							</li>
						))}
						{items.length > 5 && (
							<li className='text-muted-foreground'>
								...他 {items.length - 5}件
							</li>
						)}
					</ul>
				</div>
			)}
			{total != null && (
				<div className='font-medium'>合計: {formatAmount(total)}</div>
			)}
			{paymentMethod != null && (
				<div>
					<span className='font-medium'>支払方法:</span> {String(paymentMethod)}
				</div>
			)}
		</div>
	)
}

export function ReceiptOcrPage({
	tenant,
	accessToken,
}: {
	tenant: string
	accessToken: string
}) {
	const [receipts, setReceipts] = useState<ReceiptUpload[]>([])
	const [loading, setLoading] = useState(true)
	const [uploading, setUploading] = useState(false)
	const [typeFilter, setTypeFilter] = useState<string>('all')
	const [selectedReceipt, setSelectedReceipt] = useState<ReceiptUpload | null>(
		null,
	)
	const [isDragOver, setIsDragOver] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const cameraInputRef = useRef<HTMLInputElement>(null)

	const headers = useMemo<Record<string, string>>(
		() => ({
			'x-operator-id': tenant,
			Authorization: `Bearer ${accessToken}`,
		}),
		[accessToken, tenant],
	)

	const fetchReceipts = useCallback(async () => {
		setLoading(true)
		try {
			const params = new URLSearchParams()
			if (typeFilter !== 'all') {
				params.set('receipt_type', typeFilter)
			}
			const res = await fetch(`${BACKEND_URL}/v1/field/receipts?${params}`, {
				headers,
			})
			if (res.ok) {
				const data = await res.json()
				setReceipts(data.items ?? [])
			}
		} catch (error) {
			console.error('Failed to fetch receipts:', error)
		} finally {
			setLoading(false)
		}
	}, [headers, typeFilter])

	useEffect(() => {
		fetchReceipts()
	}, [fetchReceipts])

	const uploadFile = async (file: File, receiptType: string) => {
		setUploading(true)
		try {
			const formData = new FormData()
			formData.append('file', file)
			formData.append('receipt_type', receiptType)
			const res = await fetch(`${BACKEND_URL}/v1/field/receipts/upload`, {
				method: 'POST',
				headers,
				body: formData,
			})
			if (res.ok) {
				await fetchReceipts()
				setTimeout(fetchReceipts, 5000)
				setTimeout(fetchReceipts, 15000)
			} else {
				const text = await res.text()
				console.error('Upload failed:', text)
				alert(`アップロードに失敗しました: ${text}`)
			}
		} catch (error) {
			console.error('Upload error:', error)
			alert('アップロード中にエラーが発生しました')
		} finally {
			setUploading(false)
		}
	}

	const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (file) {
			uploadFile(file, typeFilter === 'all' ? 'sales' : typeFilter)
		}
		event.currentTarget.value = ''
	}

	const handleDrop = (event: DragEvent) => {
		event.preventDefault()
		setIsDragOver(false)
		const file = event.dataTransfer.files?.[0]
		if (file) {
			uploadFile(file, typeFilter === 'all' ? 'sales' : typeFilter)
		}
	}

	const handleReprocess = async (id: string) => {
		try {
			await fetch(`${BACKEND_URL}/v1/field/receipts/${id}/reprocess`, {
				method: 'POST',
				headers,
			})
			setTimeout(fetchReceipts, 2000)
			setTimeout(fetchReceipts, 10000)
		} catch (error) {
			console.error('Reprocess error:', error)
		}
	}

	return (
		<div className='grid flex-1 items-start gap-4'>
			<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='text-xl font-bold'>レシート OCR</h1>
					<p className='text-sm text-muted-foreground'>
						Receipt OCR / Sales and Purchase
					</p>
				</div>
				<div className='grid w-full grid-cols-[1fr_auto] gap-2 sm:flex sm:w-auto sm:items-center'>
					<Select value={typeFilter} onValueChange={setTypeFilter}>
						<SelectTrigger className='w-full sm:w-32'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>すべて</SelectItem>
							<SelectItem value='sales'>売上</SelectItem>
							<SelectItem value='purchase'>仕入</SelectItem>
						</SelectContent>
					</Select>
					<Button
						variant='outline'
						size='sm'
						className='w-full sm:w-auto'
						onClick={fetchReceipts}
						disabled={loading}
					>
						<RefreshCwIcon className='mr-2 h-4 w-4' />
						更新
					</Button>
				</div>
			</div>

			<Card>
				<CardContent className='pt-4 sm:pt-6'>
					<div
						onDragOver={event => {
							event.preventDefault()
							setIsDragOver(true)
						}}
						onDragLeave={() => setIsDragOver(false)}
						onDrop={handleDrop}
						className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors sm:p-8 ${
							isDragOver
								? 'border-primary bg-primary/5'
								: 'border-muted-foreground/25'
						}`}
					>
						{uploading ? (
							<Loader2Icon className='h-8 w-8 animate-spin text-muted-foreground' />
						) : (
							<CameraIcon className='h-8 w-8 text-muted-foreground' />
						)}
						<p className='max-w-sm text-sm text-muted-foreground'>
							レシート画像をドラッグ＆ドロップ、または
						</p>
						<input
							ref={cameraInputRef}
							type='file'
							accept='image/*'
							capture='environment'
							onChange={handleFileSelect}
							className='hidden'
						/>
						<input
							ref={fileInputRef}
							type='file'
							accept='image/jpeg,image/png,application/pdf'
							onChange={handleFileSelect}
							className='hidden'
						/>
						<div className='grid w-full gap-2 sm:flex sm:w-auto sm:items-center sm:justify-center'>
							<Button
								className='w-full sm:w-auto'
								onClick={() => cameraInputRef.current?.click()}
								disabled={uploading}
							>
								<CameraIcon className='mr-2 h-4 w-4' />
								撮影/写真を選択
							</Button>
							<Button
								variant='outline'
								className='w-full sm:w-auto'
								onClick={() => fileInputRef.current?.click()}
								disabled={uploading}
							>
								<UploadIcon className='mr-2 h-4 w-4' />
								PDF/ファイル
							</Button>
						</div>
						<p className='text-xs text-muted-foreground'>
							JPEG, PNG, PDF (最大 10MB)
						</p>
					</div>
				</CardContent>
			</Card>

			<div className='grid gap-4 lg:grid-cols-3'>
				<Card className='lg:col-span-2'>
					<CardHeader>
						<CardTitle className='text-base'>アップロード一覧</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3'>
						{loading ? (
							<div className='flex h-24 items-center justify-center'>
								<Loader2Icon className='h-6 w-6 animate-spin text-muted-foreground' />
							</div>
						) : receipts.length === 0 ? (
							<div className='flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground'>
								レシートがありません
							</div>
						) : (
							<>
								<div className='divide-y rounded-md border md:hidden'>
									{receipts.map(receipt => (
										<div
											key={receipt.id}
											role='button'
											tabIndex={0}
											className={`cursor-pointer p-3 ${
												selectedReceipt?.id === receipt.id ? 'bg-muted' : ''
											}`}
											onClick={() => setSelectedReceipt(receipt)}
											onKeyDown={event => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault()
													setSelectedReceipt(receipt)
												}
											}}
										>
											<div className='flex items-start justify-between gap-3'>
												<div className='min-w-0'>
													<p className='flex items-center gap-2 truncate text-sm font-medium'>
														<FileTextIcon className='h-4 w-4 shrink-0 text-muted-foreground' />
														{receipt.fileName ?? receipt.id.slice(0, 8)}
													</p>
													<p className='mt-1 text-xs text-muted-foreground'>
														{formatDate(receipt.createdAt)}
													</p>
												</div>
												{statusBadge(receipt.status)}
											</div>
											<div className='mt-3 flex items-center justify-between gap-3 border-t pt-3'>
												<Badge variant='outline'>
													{receiptTypeLabel(receipt.receiptType)}
												</Badge>
												{(receipt.status === 'error' ||
													receipt.status === 'done') && (
													<Button
														variant='ghost'
														size='sm'
														onClick={event => {
															event.stopPropagation()
															handleReprocess(receipt.id)
														}}
													>
														<RefreshCwIcon className='h-3 w-3' />
													</Button>
												)}
											</div>
										</div>
									))}
								</div>

								<div className='hidden overflow-x-auto md:block'>
									<Table className='min-w-[760px]'>
										<TableHeader>
											<TableRow>
												<TableHead>ファイル</TableHead>
												<TableHead>種別</TableHead>
												<TableHead>ステータス</TableHead>
												<TableHead>日時</TableHead>
												<TableHead />
											</TableRow>
										</TableHeader>
										<TableBody>
											{receipts.map(receipt => (
												<TableRow
													key={receipt.id}
													className={`cursor-pointer ${
														selectedReceipt?.id === receipt.id ? 'bg-muted' : ''
													}`}
													onClick={() => setSelectedReceipt(receipt)}
												>
													<TableCell>
														<div className='flex items-center gap-2'>
															<FileTextIcon className='h-4 w-4 text-muted-foreground' />
															<span className='truncate text-sm'>
																{receipt.fileName ?? receipt.id.slice(0, 8)}
															</span>
														</div>
													</TableCell>
													<TableCell>
														<Badge variant='outline'>
															{receiptTypeLabel(receipt.receiptType)}
														</Badge>
													</TableCell>
													<TableCell>{statusBadge(receipt.status)}</TableCell>
													<TableCell className='text-sm text-muted-foreground'>
														{formatDate(receipt.createdAt)}
													</TableCell>
													<TableCell>
														{(receipt.status === 'error' ||
															receipt.status === 'done') && (
															<Button
																variant='ghost'
																size='sm'
																onClick={event => {
																	event.stopPropagation()
																	handleReprocess(receipt.id)
																}}
															>
																<RefreshCwIcon className='h-3 w-3' />
															</Button>
														)}
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
						<CardTitle className='text-base'>OCR 結果</CardTitle>
					</CardHeader>
					<CardContent>
						{selectedReceipt ? (
							<div className='space-y-4'>
								<div className='text-sm'>
									<span className='font-medium'>ID:</span>{' '}
									<code className='break-all text-xs'>
										{selectedReceipt.id}
									</code>
								</div>
								<div className='text-sm'>
									<span className='font-medium'>ステータス:</span>{' '}
									{statusBadge(selectedReceipt.status)}
								</div>
								{selectedReceipt.errorMessage && (
									<div className='rounded-md bg-destructive/10 p-3 text-sm text-destructive'>
										{selectedReceipt.errorMessage}
									</div>
								)}
								{selectedReceipt.status === 'processing' && (
									<div className='flex items-center gap-2 text-sm text-muted-foreground'>
										<Loader2Icon className='h-4 w-4 animate-spin' />
										OCR 処理中...
									</div>
								)}
								<ExtractedDataPreview data={selectedReceipt.extractedData} />
								{selectedReceipt.rawOcrText && (
									<details className='text-sm'>
										<summary className='cursor-pointer font-medium'>
											Raw OCR テキスト
										</summary>
										<pre className='mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs'>
											{selectedReceipt.rawOcrText}
										</pre>
									</details>
								)}
							</div>
						) : (
							<p className='text-sm text-muted-foreground'>
								一覧からレシートを選択してください
							</p>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
