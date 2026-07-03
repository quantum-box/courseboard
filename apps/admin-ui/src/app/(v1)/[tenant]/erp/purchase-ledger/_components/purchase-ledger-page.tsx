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
import {
	ArrowLeftIcon,
	CheckCircle2Icon,
	DownloadIcon,
	Loader2Icon,
	PlusIcon,
	RefreshCwIcon,
	Trash2Icon,
} from 'lucide-react'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { getServerModePrefix } from 'lib/mode'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

type PurchaseLedgerEntry = {
	id: string
	tenantId: string
	date: string
	supplierId: string | null
	supplierName: string
	category: string
	itemName: string
	quantity: number
	unitCost: number
	totalCost: number
	receiptId: string | null
	status: 'draft' | 'confirmed'
	notes: string | null
	createdAt: string
	updatedAt: string
}

type SummaryItem = {
	key: string
	totalCost: number
	entryCount: number
}

type Summary = {
	supplierCosts: SummaryItem[]
	categoryCosts: SummaryItem[]
}

type ReceiptUpload = {
	id: string
	fileName: string | null
	extractedData: Record<string, unknown> | null
	status: string
	createdAt: string
}

type FormState = {
	date: string
	supplierName: string
	category: string
	itemName: string
	quantity: string
	unitCost: string
	status: 'draft' | 'confirmed'
	notes: string
}

const BACKEND_URL = getBackendBaseUrl()

const today = new Date().toISOString().slice(0, 10)

const initialForm: FormState = {
	date: today,
	supplierName: '',
	category: 'raw_material',
	itemName: '',
	quantity: '1',
	unitCost: '',
	status: 'draft',
	notes: '',
}

type PurchaseLedgerPageProps = {
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
	return status === 'confirmed' ? (
		<Badge variant='secondary'>確定</Badge>
	) : (
		<Badge variant='outline'>下書き</Badge>
	)
}

function categoryLabel(category: string) {
	const labels: Record<string, string> = {
		raw_material: '原材料',
		packaging: '包材',
		consumable: '消耗品',
		equipment: '備品',
		shipping: '配送',
		other: 'その他',
	}
	return labels[category] ?? category
}

function CostBars({
	title,
	items,
}: {
	title: string
	items: SummaryItem[]
}) {
	const max = Math.max(...items.map(item => item.totalCost), 1)

	return (
		<Card>
			<CardHeader className='pb-3'>
				<CardTitle className='text-base'>{title}</CardTitle>
			</CardHeader>
			<CardContent className='space-y-3'>
				{items.length === 0 ? (
					<p className='text-sm text-muted-foreground'>
						集計データがありません
					</p>
				) : (
					items.slice(0, 8).map(item => (
						<div key={item.key} className='space-y-1'>
							<div className='flex items-center justify-between gap-3 text-sm'>
								<span className='truncate font-medium'>
									{title.includes('カテゴリ')
										? categoryLabel(item.key)
										: item.key}
								</span>
								<span className='shrink-0 tabular-nums'>
									{formatAmount(item.totalCost)}
								</span>
							</div>
							<div className='h-2 overflow-hidden rounded bg-muted'>
								<div
									className='h-full bg-emerald-600'
									style={{
										width: `${Math.max((item.totalCost / max) * 100, 4)}%`,
									}}
								/>
							</div>
						</div>
					))
				)}
			</CardContent>
		</Card>
	)
}

export function PurchaseLedgerPage({
	tenant,
	accessToken,
	mode = 'list',
}: PurchaseLedgerPageProps) {
	const router = useRouter()
	const mp = getServerModePrefix(tenant)
	const listHref = `${mp}/${tenant}/erp/purchase-ledger`
	const inputHref = `${mp}/${tenant}/erp/purchase-ledger/input`
	const [items, setItems] = useState<PurchaseLedgerEntry[]>([])
	const [summary, setSummary] = useState<Summary>({
		supplierCosts: [],
		categoryCosts: [],
	})
	const [receipts, setReceipts] = useState<ReceiptUpload[]>([])
	const [form, setForm] = useState<FormState>(initialForm)
	const [categoryFilter, setCategoryFilter] = useState('all')
	const [statusFilter, setStatusFilter] = useState('all')
	const [loading, setLoading] = useState(true)
	const [receiptLoading, setReceiptLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [confirmingReceiptId, setConfirmingReceiptId] = useState<string | null>(
		null,
	)

	const headers = useMemo(
		() => ({
			'x-operator-id': tenant,
			Authorization: `Bearer ${accessToken}`,
		}),
		[accessToken, tenant],
	)

	const fetchReceipts = useCallback(async () => {
		setReceiptLoading(true)
		try {
			const res = await fetch(
				`${BACKEND_URL}/v1/field/receipts?receipt_type=purchase&status=done`,
				{ headers },
			)
			if (res.ok) {
				const data = await res.json()
				setReceipts(data.items ?? [])
			}
		} catch (error) {
			console.error('Failed to fetch purchase receipt data:', error)
			setReceipts([])
		} finally {
			setReceiptLoading(false)
		}
	}, [headers])

	const fetchAll = useCallback(async () => {
		setLoading(true)
		try {
			const ledgerParams = new URLSearchParams()
			if (categoryFilter !== 'all') ledgerParams.set('category', categoryFilter)
			if (statusFilter !== 'all') ledgerParams.set('status', statusFilter)

			const [ledgerRes, summaryRes] = await Promise.all([
				fetch(`${BACKEND_URL}/v1/purchase-ledger?${ledgerParams}`, {
					headers,
				}),
				fetch(`${BACKEND_URL}/v1/purchase-ledger/summary?${ledgerParams}`, {
					headers,
				}),
			])

			if (ledgerRes.ok) {
				const data = await ledgerRes.json()
				setItems(data.items ?? [])
			}
			if (summaryRes.ok) {
				const data = await summaryRes.json()
				setSummary({
					supplierCosts: data.supplierCosts ?? [],
					categoryCosts: data.categoryCosts ?? [],
				})
			}
		} catch (error) {
			console.error('Failed to fetch purchase ledger data:', error)
			setItems([])
			setSummary({ supplierCosts: [], categoryCosts: [] })
		} finally {
			setLoading(false)
		}
	}, [categoryFilter, headers, statusFilter])

	useEffect(() => {
		if (mode === 'input') {
			fetchReceipts()
			return
		}
		fetchAll()
	}, [fetchAll, fetchReceipts, mode])

	const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0)
	const confirmedCount = items.filter(
		item => item.status === 'confirmed',
	).length

	const submitManualEntry = async (event: React.FormEvent) => {
		event.preventDefault()
		setSaving(true)
		try {
			const res = await fetch(`${BACKEND_URL}/v1/purchase-ledger`, {
				method: 'POST',
				headers: {
					...headers,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					date: form.date,
					supplierName: form.supplierName,
					category: form.category,
					itemName: form.itemName,
					quantity: Number(form.quantity),
					unitCost: Number(form.unitCost),
					status: form.status,
					notes: form.notes || null,
				}),
			})
			if (!res.ok) {
				throw new Error(await res.text())
			}
			setForm(initialForm)
			router.push(listHref)
		} catch (error) {
			console.error('Failed to create purchase ledger entry:', error)
			alert('仕入台帳の登録に失敗しました')
		} finally {
			setSaving(false)
		}
	}

	const confirmFromReceipt = async (receiptId: string) => {
		setConfirmingReceiptId(receiptId)
		try {
			const res = await fetch(
				`${BACKEND_URL}/v1/purchase-ledger/from-receipt/${receiptId}`,
				{ method: 'POST', headers },
			)
			if (!res.ok) {
				throw new Error(await res.text())
			}
			router.push(listHref)
		} catch (error) {
			console.error('Failed to confirm receipt:', error)
			alert('OCRレシートからの確定に失敗しました')
		} finally {
			setConfirmingReceiptId(null)
		}
	}

	const deleteEntry = async (id: string) => {
		if (!confirm('この仕入台帳行を削除しますか？')) return
		const res = await fetch(`${BACKEND_URL}/v1/purchase-ledger/${id}`, {
			method: 'DELETE',
			headers,
		})
		if (res.ok) await fetchAll()
	}

	const exportCsv = async () => {
		const params = new URLSearchParams()
		if (categoryFilter !== 'all') params.set('category', categoryFilter)
		if (statusFilter !== 'all') params.set('status', statusFilter)
		const res = await fetch(
			`${BACKEND_URL}/v1/purchase-ledger/export/csv?${params}`,
			{ headers },
		)
		if (!res.ok) {
			alert('CSV exportに失敗しました')
			return
		}
		const blob = await res.blob()
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = `purchase-ledger-${today}.csv`
		anchor.click()
		URL.revokeObjectURL(url)
	}

	if (mode === 'input') {
		return (
			<div className='grid flex-1 items-start gap-4'>
				<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
					<div>
						<h1 className='text-xl font-bold'>仕入入力</h1>
						<p className='text-sm text-muted-foreground'>
							Manual Purchase Entry / OCR Confirmation
						</p>
					</div>
					<Button variant='outline' className='w-full sm:w-auto' asChild>
						<Link href={listHref}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							仕入一覧へ戻る
						</Link>
					</Button>
				</div>

				<div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]'>
					<Card>
						<CardHeader>
							<CardTitle className='text-base'>手動入力</CardTitle>
						</CardHeader>
						<CardContent>
							<form className='space-y-3' onSubmit={submitManualEntry}>
								<div className='grid gap-2'>
									<Label htmlFor='date'>日付</Label>
									<Input
										id='date'
										type='date'
										value={form.date}
										onChange={e => setForm({ ...form, date: e.target.value })}
										required
									/>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='supplier'>仕入先</Label>
									<Input
										id='supplier'
										value={form.supplierName}
										onChange={e =>
											setForm({ ...form, supplierName: e.target.value })
										}
										required
									/>
								</div>
								<div className='grid gap-2'>
									<Label>カテゴリ</Label>
									<Select
										value={form.category}
										onValueChange={value =>
											setForm({ ...form, category: value })
										}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='raw_material'>原材料</SelectItem>
											<SelectItem value='packaging'>包材</SelectItem>
											<SelectItem value='consumable'>消耗品</SelectItem>
											<SelectItem value='equipment'>備品</SelectItem>
											<SelectItem value='shipping'>配送</SelectItem>
											<SelectItem value='other'>その他</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='item'>品名</Label>
									<Input
										id='item'
										value={form.itemName}
										onChange={e =>
											setForm({ ...form, itemName: e.target.value })
										}
										required
									/>
								</div>
								<div className='grid gap-2 sm:grid-cols-2'>
									<div className='grid gap-2'>
										<Label htmlFor='quantity'>数量</Label>
										<Input
											id='quantity'
											type='number'
											min='0'
											step='0.01'
											value={form.quantity}
											onChange={e =>
												setForm({ ...form, quantity: e.target.value })
											}
											required
										/>
									</div>
									<div className='grid gap-2'>
										<Label htmlFor='unit-cost'>単価</Label>
										<Input
											id='unit-cost'
											type='number'
											min='0'
											step='0.01'
											value={form.unitCost}
											onChange={e =>
												setForm({ ...form, unitCost: e.target.value })
											}
											required
										/>
									</div>
								</div>
								<div className='grid gap-2'>
									<Label>ステータス</Label>
									<Select
										value={form.status}
										onValueChange={value =>
											setForm({
												...form,
												status: value as FormState['status'],
											})
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
								<div className='grid gap-2'>
									<Label htmlFor='notes'>メモ</Label>
									<Textarea
										id='notes'
										value={form.notes}
										onChange={e => setForm({ ...form, notes: e.target.value })}
									/>
								</div>
								<Button className='w-full' disabled={saving}>
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

					<Card>
						<CardHeader>
							<CardTitle className='text-base'>OCRレシートから確定</CardTitle>
						</CardHeader>
						<CardContent className='space-y-2'>
							{receiptLoading ? (
								<div className='flex h-20 items-center justify-center'>
									<Loader2Icon className='h-5 w-5 animate-spin' />
								</div>
							) : receipts.length === 0 ? (
								<p className='text-sm text-muted-foreground'>
									確定可能な仕入レシートはありません
								</p>
							) : (
								receipts.slice(0, 6).map(receipt => (
									<div
										key={receipt.id}
										className='flex flex-col gap-2 rounded border p-2 sm:flex-row sm:items-center sm:justify-between'
									>
										<div className='min-w-0'>
											<p className='truncate text-sm font-medium'>
												{receipt.fileName ?? receipt.id}
											</p>
											<p className='text-xs text-muted-foreground'>
												{receipt.id}
											</p>
										</div>
										<Button
											size='sm'
											variant='outline'
											disabled={confirmingReceiptId === receipt.id}
											onClick={() => confirmFromReceipt(receipt.id)}
										>
											{confirmingReceiptId === receipt.id ? (
												<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
											) : (
												<CheckCircle2Icon className='mr-2 h-4 w-4' />
											)}
											確定して一覧へ戻る
										</Button>
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		)
	}

	return (
		<div className='grid flex-1 items-start gap-4'>
			<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='text-xl font-bold'>仕入台帳</h1>
					<p className='text-sm text-muted-foreground'>
						Purchase Ledger / Cost Ledger
					</p>
				</div>
				<div className='grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end'>
					<Button className='col-span-2 w-full sm:w-auto' asChild>
						<Link href={inputHref}>
							<PlusIcon className='mr-2 h-4 w-4' />
							仕入入力
						</Link>
					</Button>
					<Select value={categoryFilter} onValueChange={setCategoryFilter}>
						<SelectTrigger className='w-full sm:w-40'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>カテゴリすべて</SelectItem>
							<SelectItem value='raw_material'>原材料</SelectItem>
							<SelectItem value='packaging'>包材</SelectItem>
							<SelectItem value='consumable'>消耗品</SelectItem>
							<SelectItem value='equipment'>備品</SelectItem>
							<SelectItem value='shipping'>配送</SelectItem>
							<SelectItem value='other'>その他</SelectItem>
						</SelectContent>
					</Select>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className='w-full sm:w-28'>
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
						onClick={fetchAll}
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

			<div className='grid gap-3 md:grid-cols-3'>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>合計原価</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold tabular-nums'>
						{formatAmount(totalCost)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>台帳行</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold tabular-nums'>
						{items.length}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>確定済み</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold tabular-nums'>
						{confirmedCount}
					</CardContent>
				</Card>
			</div>

			<div className='grid gap-4'>
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>仕入一覧</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3'>
						{loading ? (
							<div className='flex h-24 items-center justify-center'>
								<Loader2Icon className='h-5 w-5 animate-spin' />
							</div>
						) : items.length === 0 ? (
							<div className='flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground'>
								仕入台帳がありません
							</div>
						) : (
							<>
								<div className='divide-y rounded-md border md:hidden'>
									{items.map(item => (
										<div key={item.id} className='p-3'>
											<div className='flex items-start justify-between gap-3'>
												<div className='min-w-0'>
													<p className='truncate text-sm font-semibold'>
														{item.itemName}
													</p>
													<p className='mt-1 truncate text-xs text-muted-foreground'>
														{item.supplierName}
													</p>
												</div>
												<div className='shrink-0'>
													{statusBadge(item.status)}
												</div>
											</div>
											<div className='mt-3 grid grid-cols-2 gap-3 text-sm'>
												<div className='min-w-0'>
													<p className='text-xs text-muted-foreground'>日付</p>
													<p className='tabular-nums'>{item.date}</p>
												</div>
												<div className='min-w-0'>
													<p className='text-xs text-muted-foreground'>
														カテゴリ
													</p>
													<p className='truncate'>
														{categoryLabel(item.category)}
													</p>
												</div>
												<div className='min-w-0'>
													<p className='text-xs text-muted-foreground'>数量</p>
													<p className='tabular-nums'>{item.quantity}</p>
												</div>
												<div className='min-w-0'>
													<p className='text-xs text-muted-foreground'>単価</p>
													<p className='tabular-nums'>
														{formatAmount(item.unitCost)}
													</p>
												</div>
											</div>
											<div className='mt-3 flex items-center justify-between gap-3 border-t pt-3'>
												<div className='min-w-0'>
													<p className='text-xs text-muted-foreground'>金額</p>
													<p className='truncate font-semibold tabular-nums'>
														{formatAmount(item.totalCost)}
													</p>
												</div>
												<Button
													variant='ghost'
													size='icon'
													aria-label={`${item.itemName}を削除`}
													onClick={() => deleteEntry(item.id)}
												>
													<Trash2Icon className='h-4 w-4' />
												</Button>
											</div>
										</div>
									))}
								</div>

								<div className='hidden overflow-x-auto md:block'>
									<Table className='min-w-[920px]'>
										<TableHeader>
											<TableRow>
												<TableHead>日付</TableHead>
												<TableHead>仕入先</TableHead>
												<TableHead>カテゴリ</TableHead>
												<TableHead>品名</TableHead>
												<TableHead className='text-right'>数量</TableHead>
												<TableHead className='text-right'>単価</TableHead>
												<TableHead className='text-right'>金額</TableHead>
												<TableHead>ステータス</TableHead>
												<TableHead />
											</TableRow>
										</TableHeader>
										<TableBody>
											{items.map(item => (
												<TableRow key={item.id}>
													<TableCell>{item.date}</TableCell>
													<TableCell className='font-medium'>
														{item.supplierName}
													</TableCell>
													<TableCell>{categoryLabel(item.category)}</TableCell>
													<TableCell>{item.itemName}</TableCell>
													<TableCell className='text-right tabular-nums'>
														{item.quantity}
													</TableCell>
													<TableCell className='text-right tabular-nums'>
														{formatAmount(item.unitCost)}
													</TableCell>
													<TableCell className='text-right font-medium tabular-nums'>
														{formatAmount(item.totalCost)}
													</TableCell>
													<TableCell>{statusBadge(item.status)}</TableCell>
													<TableCell className='text-right'>
														<Button
															variant='ghost'
															size='icon'
															aria-label={`${item.itemName}を削除`}
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
			</div>

			<div className='grid gap-4 lg:grid-cols-2'>
				<CostBars title='仕入先別コスト集計' items={summary.supplierCosts} />
				<CostBars title='カテゴリ別コスト集計' items={summary.categoryCosts} />
			</div>
		</div>
	)
}

export function PurchaseLedgerInputPage({
	tenant,
	accessToken,
}: {
	tenant: string
	accessToken: string
}) {
	return (
		<PurchaseLedgerPage
			tenant={tenant}
			accessToken={accessToken}
			mode='input'
		/>
	)
}
