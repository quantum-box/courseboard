'use client'

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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { Textarea } from 'components/ui/textarea'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { getServerModePrefix } from 'lib/mode'
import {
	ArrowLeftIcon,
	CameraIcon,
	CheckCircle2Icon,
	DownloadIcon,
	Loader2Icon,
	PlusIcon,
	RefreshCwIcon,
	Trash2Icon,
	UploadIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
	type ChangeEvent,
	type DragEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import { mapOcrToSalesLedgerForm } from './map-ocr-to-sales-ledger-form'

type SalesLedgerEntry = {
	id: string
	tenantId: string
	date: string
	registerClosedAt?: string | null
	productId: string | null
	productName: string
	quantity: number
	unitPrice: number
	totalAmount: number
	paymentMethod: string | null
	receiptId: string | null
	status: string
	notes: string | null
	createdAt: string
	updatedAt: string
}

type SalesLedgerSummary = {
	period: string
	entryCount: number
	quantity: number
	totalAmount: number
}

type ReceiptUpload = {
	id: string
	fileName: string | null
	receiptType: string
	status: string
	extractedData: Record<string, unknown> | null
	errorMessage: string | null
	createdAt: string
}

type FormState = {
	registerClosedAt: string
	productName: string
	quantity: string
	unitPrice: string
	totalAmount: string
	paymentMethod: string
	status: string
	notes: string
}

const BACKEND_URL = getBackendBaseUrl()
const OCR_POLL_INTERVAL_MS = 2000
const OCR_POLL_MAX_ATTEMPTS = 30
const RECEIPT_OCR_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const RECEIPT_OCR_ACCEPT =
	'image/jpeg,image/png,application/pdf,image/heic,image/heif,.heic,.heif'

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

function isHeicFile(file: File) {
	const type = file.type.toLowerCase()
	const name = file.name.toLowerCase()
	return (
		type === 'image/heic' ||
		type === 'image/heif' ||
		name.endsWith('.heic') ||
		name.endsWith('.heif')
	)
}

function jpegFileName(fileName: string) {
	const baseName = fileName.replace(/\.[^/.]+$/, '')
	return `${baseName || 'receipt'}.jpg`
}

async function prepareReceiptOcrFile(file: File) {
	if (!isHeicFile(file)) {
		return file
	}

	const { default: heic2any } = await import('heic2any')
	const converted = await heic2any({
		blob: file,
		quality: 0.92,
		toType: 'image/jpeg',
	})
	const jpegBlob = Array.isArray(converted) ? converted[0] : converted
	if (!jpegBlob) {
		throw new Error('HEIC 画像の変換に失敗しました')
	}

	return new File([jpegBlob], jpegFileName(file.name), {
		lastModified: file.lastModified,
		type: 'image/jpeg',
	})
}

function formatDateTimeLocal(date: Date) {
	const offsetMs = date.getTimezoneOffset() * 60_000
	return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

const initialForm = (): FormState => ({
	registerClosedAt: formatDateTimeLocal(new Date()),
	productName: '',
	quantity: '1',
	unitPrice: '',
	totalAmount: '',
	paymentMethod: 'cash',
	status: 'draft',
	notes: '',
})

type SalesLedgerPageProps = {
	tenant: string
	accessToken: string
	mode?: 'list' | 'input'
}

function formatAmount(value: number) {
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0,
	}).format(value)
}

function statusBadge(status: string) {
	if (status === 'confirmed') {
		return <Badge variant='secondary'>確定</Badge>
	}
	return <Badge variant='outline'>下書き</Badge>
}

function receiptLabel(receipt: ReceiptUpload) {
	const total = Number(receipt.extractedData?.total ?? 0)
	const closedAt = String(
		receipt.extractedData?.register_closed_at ??
			receipt.extractedData?.registerClosedAt ??
			receipt.extractedData?.closed_at ??
			receipt.extractedData?.closedAt ??
			receipt.extractedData?.date ??
			receipt.createdAt.slice(0, 10),
	)
	const file = receipt.fileName ?? receipt.id.slice(0, 8)
	return `${closedAt.replace('T', ' ')} / ${file} / ${formatAmount(total)}`
}

function displayClosedAt(item: SalesLedgerEntry) {
	return (item.registerClosedAt ?? `${item.date}T00:00`)
		.replace('T', ' ')
		.slice(0, 16)
}

function ocrPreviewAmount(data: Record<string, unknown>) {
	return data.total ?? data.totalAmount ?? data.total_amount ?? data.grand_total
}

function ocrPreviewAmountNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.round(value)
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(
			value
				.replace(/[０-９]/g, char =>
					String.fromCharCode(char.charCodeAt(0) - 0xfee0),
				)
				.replace(/[,\s円¥￥]/g, ''),
		)
		if (Number.isFinite(parsed)) {
			return Math.round(parsed)
		}
	}
	return null
}

function ocrPreviewCounterparty(data: Record<string, unknown>) {
	return data.store_name ?? data.storeName
}

export function SalesLedgerPage({
	tenant,
	mode = 'list',
}: SalesLedgerPageProps) {
	const router = useRouter()
	const mp = getServerModePrefix(tenant)
	const listHref = `${mp}/${tenant}/erp/sales-ledger`
	const inputHref = `${mp}/${tenant}/erp/sales-ledger/input`
	const [items, setItems] = useState<SalesLedgerEntry[]>([])
	const [summaries, setSummaries] = useState<SalesLedgerSummary[]>([])
	const [receipts, setReceipts] = useState<ReceiptUpload[]>([])
	const [loading, setLoading] = useState(true)
	const [receiptLoading, setReceiptLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [groupBy, setGroupBy] = useState('day')
	const [statusFilter, setStatusFilter] = useState('all')
	const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
	const [selectedReceiptId, setSelectedReceiptId] = useState('')
	const [form, setForm] = useState<FormState>(initialForm)
	const [linkedReceiptId, setLinkedReceiptId] = useState<string | null>(null)
	const [uploading, setUploading] = useState(false)
	const [ocrPolling, setOcrPolling] = useState(false)
	const [ocrError, setOcrError] = useState<string | null>(null)
	const [ocrPreview, setOcrPreview] = useState<Record<string, unknown> | null>(
		null,
	)
	const [isDragOver, setIsDragOver] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const cameraInputRef = useRef<HTMLInputElement>(null)
	const pollAbortRef = useRef(false)

	const refreshAccessToken = useCallback(
		async (force = false) => {
			const res = await fetch('/api/auth/field-token', {
				body: JSON.stringify({ force }),
				headers: { 'content-type': 'application/json' },
				method: 'POST',
			})
			if (!res.ok) {
				router.replace('/auth/sign_out?error=expired')
				throw new Error('認証の有効期限が切れました。再ログインしてください。')
			}
			const data = (await res.json()) as { accessToken?: string }
			if (!data.accessToken) {
				router.replace('/auth/sign_out?error=expired')
				throw new Error('認証トークンを更新できませんでした')
			}
			return data.accessToken
		},
		[router],
	)

	const getHeaders = useCallback(
		async (forceRefresh = false): Promise<Record<string, string>> => {
			const token = await refreshAccessToken(forceRefresh)
			return {
				'x-operator-id': tenant,
				Authorization: `Bearer ${token}`,
			}
		},
		[refreshAccessToken, tenant],
	)

	const fetchLedger = useCallback(async () => {
		setLoading(true)
		try {
			const params = new URLSearchParams()
			params.set('group_by', groupBy)
			if (month) params.set('month', month)
			if (statusFilter !== 'all') params.set('status', statusFilter)
			const headers = await getHeaders()
			const res = await fetch(`${BACKEND_URL}/v1/sales-ledger?${params}`, {
				headers,
			})
			if (!res.ok) throw new Error(await res.text())
			const data = await res.json()
			setItems(data.items ?? [])
			setSummaries(data.summaries ?? [])
		} catch (e) {
			console.error('Failed to fetch sales ledger:', e)
		} finally {
			setLoading(false)
		}
	}, [getHeaders, groupBy, month, statusFilter])

	const fetchReceipts = useCallback(async () => {
		setReceiptLoading(true)
		try {
			const params = new URLSearchParams({
				receipt_type: 'sales',
				status: 'done',
			})
			const headers = await getHeaders()
			const res = await fetch(`${BACKEND_URL}/v1/field/receipts?${params}`, {
				headers,
			})
			if (res.ok) {
				const data = await res.json()
				setReceipts(data.items ?? [])
			}
		} catch (e) {
			console.error('Failed to fetch receipts:', e)
			setReceipts([])
		} finally {
			setReceiptLoading(false)
		}
	}, [getHeaders])

	useEffect(() => {
		if (mode === 'input') {
			fetchReceipts()
			return
		}
		fetchLedger()
	}, [fetchLedger, fetchReceipts, mode])

	useEffect(() => {
		return () => {
			pollAbortRef.current = true
		}
	}, [])

	const pollReceiptUntilDone = useCallback(
		async (receiptId: string): Promise<ReceiptUpload> => {
			for (let attempt = 0; attempt < OCR_POLL_MAX_ATTEMPTS; attempt += 1) {
				if (pollAbortRef.current) {
					throw new Error('OCR polling cancelled')
				}
				const headers = await getHeaders()
				const res = await fetch(
					`${BACKEND_URL}/v1/field/receipts/${receiptId}`,
					{ headers },
				)
				if (!res.ok) {
					throw new Error(await res.text())
				}
				const receipt = (await res.json()) as ReceiptUpload
				if (receipt.status === 'done') {
					return receipt
				}
				if (receipt.status === 'error') {
					throw new Error(receipt.errorMessage ?? 'OCR processing failed')
				}
				if (attempt < OCR_POLL_MAX_ATTEMPTS - 1) {
					await sleep(OCR_POLL_INTERVAL_MS)
				}
			}
			throw new Error('OCR processing timed out')
		},
		[getHeaders],
	)

	const applyOcrToForm = useCallback(
		(receipt: ReceiptUpload) => {
			if (!receipt.extractedData) {
				throw new Error('OCR result is empty')
			}
			const mapped = mapOcrToSalesLedgerForm(
				receipt.extractedData,
				form.registerClosedAt,
			)
			setForm(mapped)
			setLinkedReceiptId(receipt.id)
			setOcrPreview(receipt.extractedData)
		},
		[form.registerClosedAt],
	)

	const uploadAndProcessReceipt = useCallback(
		async (file: File) => {
			if (uploading || ocrPolling) return
			pollAbortRef.current = false
			setUploading(true)
			setOcrPolling(false)
			setOcrError(null)
			setOcrPreview(null)
			setLinkedReceiptId(null)
			try {
				const uploadFile = await prepareReceiptOcrFile(file)
				if (uploadFile.size > RECEIPT_OCR_MAX_FILE_SIZE_BYTES) {
					throw new Error('OCRに使用できるファイルサイズは10MBまでです')
				}
				const formData = new FormData()
				formData.append('file', uploadFile)
				formData.append('receipt_type', 'sales')
				const headers = await getHeaders(true)
				const uploadRes = await fetch(
					`${BACKEND_URL}/v1/field/receipts/upload`,
					{
						method: 'POST',
						headers,
						body: formData,
					},
				)
				if (!uploadRes.ok) {
					throw new Error(await uploadRes.text())
				}
				const uploaded = (await uploadRes.json()) as ReceiptUpload
				setUploading(false)
				if (uploaded.status === 'done' && uploaded.extractedData) {
					applyOcrToForm(uploaded)
					await fetchReceipts()
					return
				}
				setOcrPolling(true)
				const receipt = await pollReceiptUntilDone(uploaded.id)
				applyOcrToForm(receipt)
				await fetchReceipts()
			} catch (error) {
				console.error('Receipt upload/OCR failed:', error)
				setOcrError(
					error instanceof Error
						? error.message
						: 'Receipt upload or OCR failed',
				)
			} finally {
				setUploading(false)
				setOcrPolling(false)
			}
		},
		[
			applyOcrToForm,
			fetchReceipts,
			getHeaders,
			ocrPolling,
			pollReceiptUntilDone,
			uploading,
		],
	)

	const handleReceiptFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (file) {
			void uploadAndProcessReceipt(file)
		}
		event.currentTarget.value = ''
	}

	const handleReceiptDrop = (event: DragEvent) => {
		event.preventDefault()
		setIsDragOver(false)
		const file = event.dataTransfer.files?.[0]
		if (file) {
			void uploadAndProcessReceipt(file)
		}
	}

	const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0)
	const confirmedAmount = items
		.filter(item => item.status === 'confirmed')
		.reduce((sum, item) => sum + item.totalAmount, 0)
	const ocrAmount = ocrPreview ? ocrPreviewAmount(ocrPreview) : null
	const ocrAmountNumber = ocrPreviewAmountNumber(ocrAmount)
	const ocrCounterparty = ocrPreview ? ocrPreviewCounterparty(ocrPreview) : null

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault()
		setSaving(true)
		try {
			const quantity = Number(form.quantity)
			const unitPrice = Number(form.unitPrice)
			const totalAmount = form.totalAmount
				? Number(form.totalAmount)
				: undefined
			const headers = await getHeaders(true)
			const res = await fetch(`${BACKEND_URL}/v1/sales-ledger`, {
				method: 'POST',
				headers: {
					...headers,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					date: form.registerClosedAt.slice(0, 10),
					registerClosedAt: form.registerClosedAt,
					productName: form.productName,
					quantity,
					unitPrice,
					totalAmount,
					paymentMethod: form.paymentMethod,
					status: form.status,
					notes: form.notes || undefined,
					receiptId: linkedReceiptId ?? undefined,
				}),
			})
			if (!res.ok) throw new Error(await res.text())
			setForm(initialForm())
			setLinkedReceiptId(null)
			setOcrPreview(null)
			setOcrError(null)
			router.push(listHref)
		} catch (e) {
			console.error('Failed to save sales ledger:', e)
			alert('売上台帳の保存に失敗しました')
		} finally {
			setSaving(false)
		}
	}

	const confirmReceipt = async () => {
		if (!selectedReceiptId) return
		setSaving(true)
		try {
			const headers = await getHeaders(true)
			const res = await fetch(
				`${BACKEND_URL}/v1/sales-ledger/from-receipt/${selectedReceiptId}`,
				{
					method: 'POST',
					headers,
				},
			)
			if (!res.ok) throw new Error(await res.text())
			setSelectedReceiptId('')
			router.push(listHref)
		} catch (e) {
			console.error('Failed to confirm receipt:', e)
			alert('OCR レシートの台帳確定に失敗しました')
		} finally {
			setSaving(false)
		}
	}

	const deleteEntry = async (id: string) => {
		if (!window.confirm('この売上台帳明細を削除しますか？')) return
		try {
			const headers = await getHeaders()
			const res = await fetch(`${BACKEND_URL}/v1/sales-ledger/${id}`, {
				method: 'DELETE',
				headers,
			})
			if (!res.ok) throw new Error(await res.text())
			await fetchLedger()
		} catch (e) {
			console.error('Failed to delete sales ledger:', e)
			alert('売上台帳の削除に失敗しました')
		}
	}

	const exportCsv = async () => {
		const params = new URLSearchParams()
		if (month) params.set('month', month)
		if (statusFilter !== 'all') params.set('status', statusFilter)
		try {
			const headers = await getHeaders()
			const res = await fetch(
				`${BACKEND_URL}/v1/sales-ledger/export/csv?${params}`,
				{ headers },
			)
			if (!res.ok) throw new Error(await res.text())
			const blob = await res.blob()
			const url = URL.createObjectURL(blob)
			const link = document.createElement('a')
			link.href = url
			link.download = 'sales-ledger.csv'
			link.click()
			URL.revokeObjectURL(url)
		} catch (e) {
			console.error('Failed to export sales ledger:', e)
			alert('CSV export に失敗しました')
		}
	}

	if (mode === 'input') {
		return (
			<div className='grid flex-1 items-start gap-4'>
				<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
					<div>
						<h1 className='text-xl font-bold'>売上入力</h1>
						<p className='text-sm text-muted-foreground'>
							Manual Sales Entry / OCR Confirmation
						</p>
					</div>
					<Button variant='outline' className='w-full sm:w-auto' asChild>
						<Link href={listHref}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							売上一覧へ戻る
						</Link>
					</Button>
				</div>

				<div className='grid gap-4 lg:grid-cols-2'>
					<Card>
						<CardHeader>
							<CardTitle className='text-base'>
								レシート画像アップロード
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-3'>
							<div
								onDragOver={event => {
									event.preventDefault()
									if (!uploading && !ocrPolling) {
										setIsDragOver(true)
									}
								}}
								onDragLeave={() => setIsDragOver(false)}
								onDrop={handleReceiptDrop}
								className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors sm:p-6 ${
									isDragOver
										? 'border-primary bg-primary/5'
										: 'border-muted-foreground/25'
								}`}
							>
								{uploading || ocrPolling ? (
									<Loader2Icon className='h-8 w-8 animate-spin text-muted-foreground' />
								) : (
									<CameraIcon className='h-8 w-8 text-muted-foreground' />
								)}
								<p className='max-w-sm text-sm text-muted-foreground'>
									{ocrPolling
										? 'OCR 処理中です。完了すると右のフォームへ自動入力されます。'
										: 'レシート画像をドラッグ＆ドロップ、またはファイルを選択'}
								</p>
								<input
									ref={cameraInputRef}
									type='file'
									accept='image/*,.heic,.heif'
									capture='environment'
									onChange={handleReceiptFileSelect}
									className='hidden'
								/>
								<input
									ref={fileInputRef}
									type='file'
									accept={RECEIPT_OCR_ACCEPT}
									onChange={handleReceiptFileSelect}
									className='hidden'
								/>
								<div className='grid w-full gap-2 sm:flex sm:w-auto sm:items-center sm:justify-center'>
									<Button
										type='button'
										className='w-full sm:w-auto'
										onClick={() => cameraInputRef.current?.click()}
										disabled={uploading || ocrPolling}
									>
										<CameraIcon className='mr-2 h-4 w-4' />
										撮影/写真を選択
									</Button>
									<Button
										type='button'
										variant='outline'
										className='w-full sm:w-auto'
										onClick={() => fileInputRef.current?.click()}
										disabled={uploading || ocrPolling}
									>
										<UploadIcon className='mr-2 h-4 w-4' />
										PDF/ファイル
									</Button>
								</div>
								<p className='text-xs text-muted-foreground'>
									JPEG, PNG, PDF (最大 10MB)
								</p>
							</div>
							{ocrError && (
								<p className='text-sm text-destructive'>{ocrError}</p>
							)}
							{ocrPreview && (
								<div className='rounded-md border bg-muted/30 p-3 text-sm'>
									<p className='font-medium'>OCR 結果プレビュー</p>
									{ocrCounterparty != null && (
										<p className='mt-1 text-muted-foreground'>
											店舗: {String(ocrCounterparty)}
										</p>
									)}
									{ocrAmountNumber != null && (
										<p className='text-muted-foreground'>
											合計: {formatAmount(ocrAmountNumber)}
										</p>
									)}
									{linkedReceiptId && (
										<p className='mt-1 text-xs text-muted-foreground'>
											Receipt ID: {linkedReceiptId.slice(0, 8)}
										</p>
									)}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className='text-base'>手動入力</CardTitle>
						</CardHeader>
						<CardContent>
							<form className='space-y-3' onSubmit={handleSubmit}>
								<div className='grid gap-2'>
									<Label htmlFor='register-closed-at'>レジ締め日時</Label>
									<Input
										id='register-closed-at'
										type='datetime-local'
										value={form.registerClosedAt}
										onChange={event =>
											setForm(current => ({
												...current,
												registerClosedAt: event.target.value,
											}))
										}
										required
									/>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='product-name'>商品名</Label>
									<Input
										id='product-name'
										value={form.productName}
										onChange={event =>
											setForm(current => ({
												...current,
												productName: event.target.value,
											}))
										}
										required
									/>
								</div>
								<div className='grid gap-3 sm:grid-cols-2'>
									<div className='grid gap-2'>
										<Label htmlFor='quantity'>数量</Label>
										<Input
											id='quantity'
											type='number'
											min='1'
											value={form.quantity}
											onChange={event =>
												setForm(current => ({
													...current,
													quantity: event.target.value,
												}))
											}
										/>
									</div>
									<div className='grid gap-2'>
										<Label htmlFor='unit-price'>単価</Label>
										<Input
											id='unit-price'
											type='number'
											min='0'
											value={form.unitPrice}
											onChange={event =>
												setForm(current => ({
													...current,
													unitPrice: event.target.value,
												}))
											}
											required
										/>
									</div>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='total-amount'>合計金額</Label>
									<Input
										id='total-amount'
										type='number'
										min='0'
										placeholder='未入力なら 数量 x 単価'
										value={form.totalAmount}
										onChange={event =>
											setForm(current => ({
												...current,
												totalAmount: event.target.value,
											}))
										}
									/>
								</div>
								<div className='grid gap-3 sm:grid-cols-2'>
									<div className='grid gap-2'>
										<Label>支払方法</Label>
										<Select
											value={form.paymentMethod}
											onValueChange={value =>
												setForm(current => ({
													...current,
													paymentMethod: value,
												}))
											}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value='cash'>現金</SelectItem>
												<SelectItem value='credit_card'>カード</SelectItem>
												<SelectItem value='ic_card'>IC</SelectItem>
												<SelectItem value='qr_code'>QR</SelectItem>
												<SelectItem value='other'>その他</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<div className='grid gap-2'>
										<Label>ステータス</Label>
										<Select
											value={form.status}
											onValueChange={value =>
												setForm(current => ({
													...current,
													status: value,
												}))
											}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value='draft'>下書き</SelectItem>
												<SelectItem value='confirmed'>確定</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='notes'>備考</Label>
									<Textarea
										id='notes'
										value={form.notes}
										onChange={event =>
											setForm(current => ({
												...current,
												notes: event.target.value,
											}))
										}
									/>
								</div>
								<Button type='submit' disabled={saving} className='w-full'>
									{saving ? (
										<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
									) : (
										<PlusIcon className='mr-2 h-4 w-4' />
									)}
									登録して一覧へ戻る
								</Button>
							</form>
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className='text-base'>
							OCR レシートから一括確定
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3'>
						{receiptLoading ? (
							<div className='flex h-20 items-center justify-center'>
								<Loader2Icon className='h-5 w-5 animate-spin' />
							</div>
						) : receipts.length === 0 ? (
							<p className='text-sm text-muted-foreground'>
								確定可能な売上レシートはありません
							</p>
						) : (
							<>
								<Select
									value={selectedReceiptId || 'none'}
									onValueChange={value =>
										setSelectedReceiptId(value === 'none' ? '' : value)
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='none'>レシートを選択</SelectItem>
										{receipts.map(receipt => (
											<SelectItem key={receipt.id} value={receipt.id}>
												{receiptLabel(receipt)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									type='button'
									onClick={confirmReceipt}
									disabled={!selectedReceiptId || saving}
									className='w-full'
								>
									<CheckCircle2Icon className='mr-2 h-4 w-4' />
									確定して一覧へ戻る
								</Button>
							</>
						)}
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className='grid flex-1 items-start gap-4'>
			<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
				<h1 className='text-xl font-bold'>売上台帳</h1>
				<div className='grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end'>
					<Button className='col-span-2 w-full sm:w-auto' asChild>
						<Link href={inputHref}>
							<PlusIcon className='mr-2 h-4 w-4' />
							売上入力
						</Link>
					</Button>
					<Input
						type='month'
						value={month}
						onChange={event => setMonth(event.target.value)}
						className='w-full sm:w-40'
					/>
					<Select value={groupBy} onValueChange={setGroupBy}>
						<SelectTrigger className='w-full sm:w-32'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='day'>日別</SelectItem>
							<SelectItem value='month'>月別</SelectItem>
						</SelectContent>
					</Select>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className='w-full sm:w-32'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>すべて</SelectItem>
							<SelectItem value='draft'>下書き</SelectItem>
							<SelectItem value='confirmed'>確定</SelectItem>
						</SelectContent>
					</Select>
					<Button
						variant='outline'
						size='sm'
						className='w-full sm:w-auto'
						onClick={fetchLedger}
					>
						<RefreshCwIcon className='mr-2 h-4 w-4' />
						更新
					</Button>
					<Button
						variant='outline'
						size='sm'
						className='w-full sm:w-auto'
						onClick={exportCsv}
					>
						<DownloadIcon className='mr-2 h-4 w-4' />
						CSV
					</Button>
				</div>
			</div>

			<div className='grid gap-4 md:grid-cols-3'>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>対象期間売上</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold'>
						{formatAmount(totalAmount)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>確定売上</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold'>
						{formatAmount(confirmedAmount)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>明細数</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold'>
						{items.length}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className='text-base'>売上明細</CardTitle>
				</CardHeader>
				<CardContent className='space-y-3'>
					{loading ? (
						<div className='flex h-24 items-center justify-center'>
							<Loader2Icon className='h-5 w-5 animate-spin text-muted-foreground' />
						</div>
					) : items.length === 0 ? (
						<div className='flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground'>
							売上台帳明細がありません
						</div>
					) : (
						<>
							<div className='divide-y rounded-md border md:hidden'>
								{items.map(item => (
									<div key={item.id} className='p-3'>
										<div className='flex items-start justify-between gap-3'>
											<div className='min-w-0'>
												<p className='truncate text-sm font-semibold'>
													{item.productName}
												</p>
												<p className='mt-1 text-xs text-muted-foreground'>
													{displayClosedAt(item)}
												</p>
											</div>
											<div className='shrink-0'>{statusBadge(item.status)}</div>
										</div>
										<div className='mt-3 grid grid-cols-2 gap-3 text-sm'>
											<div className='min-w-0'>
												<p className='text-xs text-muted-foreground'>数量</p>
												<p className='tabular-nums'>{item.quantity}</p>
											</div>
											<div className='min-w-0'>
												<p className='text-xs text-muted-foreground'>
													支払方法
												</p>
												<p className='truncate'>{item.paymentMethod ?? '-'}</p>
											</div>
										</div>
										<div className='mt-3 flex items-center justify-between gap-3 border-t pt-3'>
											<div className='min-w-0'>
												<p className='text-xs text-muted-foreground'>金額</p>
												<p className='truncate font-semibold tabular-nums'>
													{formatAmount(item.totalAmount)}
												</p>
											</div>
											<Button
												variant='ghost'
												size='icon'
												aria-label={`${item.productName}を削除`}
												onClick={() => deleteEntry(item.id)}
											>
												<Trash2Icon className='h-4 w-4' />
											</Button>
										</div>
									</div>
								))}
							</div>

							<div className='hidden overflow-x-auto md:block'>
								<Table className='min-w-[760px]'>
									<TableHeader>
										<TableRow>
											<TableHead>レジ締め日時</TableHead>
											<TableHead>商品</TableHead>
											<TableHead className='text-right'>数量</TableHead>
											<TableHead className='text-right'>金額</TableHead>
											<TableHead>ステータス</TableHead>
											<TableHead />
										</TableRow>
									</TableHeader>
									<TableBody>
										{items.map(item => (
											<TableRow key={item.id}>
												<TableCell className='whitespace-nowrap'>
													{displayClosedAt(item)}
												</TableCell>
												<TableCell>
													<div className='font-medium'>{item.productName}</div>
													<div className='text-xs text-muted-foreground'>
														{item.paymentMethod ?? '-'}
														{item.receiptId
															? ` / OCR ${item.receiptId.slice(0, 8)}`
															: ''}
													</div>
												</TableCell>
												<TableCell className='text-right'>
													{item.quantity}
												</TableCell>
												<TableCell className='text-right'>
													{formatAmount(item.totalAmount)}
												</TableCell>
												<TableCell>{statusBadge(item.status)}</TableCell>
												<TableCell className='text-right'>
													<Button
														variant='ghost'
														size='icon'
														aria-label={`${item.productName}を削除`}
														onClick={() => deleteEntry(item.id)}
													>
														<Trash2Icon className='h-4 w-4' />
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

			<Card>
				<CardHeader>
					<CardTitle className='text-base'>集計</CardTitle>
				</CardHeader>
				<CardContent>
					<div className='space-y-2'>
						{summaries.length === 0 ? (
							<p className='text-sm text-muted-foreground'>集計なし</p>
						) : (
							summaries.slice(0, 8).map(summary => (
								<div
									key={summary.period}
									className='flex items-center justify-between border-b py-2 text-sm last:border-b-0'
								>
									<span>{summary.period}</span>
									<span className='font-medium'>
										{formatAmount(summary.totalAmount)}
									</span>
								</div>
							))
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

export function SalesLedgerInputPage({
	tenant,
	accessToken,
}: {
	tenant: string
	accessToken: string
}) {
	return (
		<SalesLedgerPage tenant={tenant} accessToken={accessToken} mode='input' />
	)
}
