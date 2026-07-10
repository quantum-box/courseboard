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
import { Loader2Icon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Summary = {
	receivableOutstanding: number
	receivableOverdue: number
	payableOutstanding: number
	payableOverdue: number
}

type ArApItem = {
	id: string
	kind: 'receivable' | 'payable'
	sourceType: string
	sourceId: string
	sourceNumber: string | null
	counterpartyName: string
	issueDate: string
	dueDate: string
	currency: string
	totalAmount: number
	settledAmount: number
	outstandingAmount: number
	effectiveStatus: string
	daysOverdue: number
	journalEntryId: string | null
}

type AgingBucket = {
	kind: 'receivable' | 'payable'
	bucket: string
	amount: number
	itemCount: number
}

type BalanceRow = {
	kind: 'receivable' | 'payable'
	counterpartyName: string
	outstandingAmount: number
	overdueAmount: number
	itemCount: number
}

type Props = {
	tenant: string
	accessToken: string
	initialItemId?: string
}

const BACKEND_URL = getBackendBaseUrl()

function today() {
	return new Date().toISOString().slice(0, 10)
}

function nextMonth() {
	const date = new Date()
	date.setDate(date.getDate() + 30)
	return date.toISOString().slice(0, 10)
}

function formatAmount(value: number) {
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0,
	}).format(value)
}

function kindLabel(kind: string) {
	return kind === 'receivable' ? '売掛' : '買掛'
}

function statusLabel(status: string) {
	return (
		{
			open: '未回収/未払',
			partially_settled: '一部消込',
			settled: '完了',
			overdue: '期日超過',
			voided: '取消',
		}[status] ?? status
	)
}

function statusBadge(status: string) {
	if (status === 'overdue') return <Badge variant='destructive'>期日超過</Badge>
	if (status === 'settled') return <Badge>完了</Badge>
	return <Badge variant='outline'>{statusLabel(status)}</Badge>
}

export function ArApPage({ tenant, accessToken, initialItemId }: Props) {
	const [summary, setSummary] = useState<Summary | null>(null)
	const [items, setItems] = useState<ArApItem[]>([])
	const [aging, setAging] = useState<AgingBucket[]>([])
	const [balances, setBalances] = useState<BalanceRow[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [kind, setKind] = useState('all')
	const [asOf, setAsOf] = useState(today)
	const [form, setForm] = useState({
		kind: 'receivable',
		counterpartyName: '',
		sourceNumber: '',
		issueDate: today(),
		dueDate: nextMonth(),
		totalAmount: '',
	})
	const [settlementItemId, setSettlementItemId] = useState(initialItemId ?? '')
	const [settlementAmount, setSettlementAmount] = useState('')

	const headers = useMemo(
		() => ({
			'x-operator-id': tenant,
			Authorization: `Bearer ${accessToken}`,
			'content-type': 'application/json',
		}),
		[accessToken, tenant],
	)

	const fetchArAp = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const itemParams = new URLSearchParams({ as_of: asOf })
			if (kind !== 'all') itemParams.set('kind', kind)
			const asOfParams = new URLSearchParams({ as_of: asOf })
			const [summaryRes, itemsRes, agingRes, balancesRes] = await Promise.all([
				fetch(`${BACKEND_URL}/v1/erp/ar-ap/summary?${asOfParams}`, {
					headers,
				}),
				fetch(`${BACKEND_URL}/v1/erp/ar-ap/items?${itemParams}`, {
					headers,
				}),
				fetch(`${BACKEND_URL}/v1/erp/ar-ap/aging?${asOfParams}`, {
					headers,
				}),
				fetch(`${BACKEND_URL}/v1/erp/ar-ap/balances?${asOfParams}`, {
					headers,
				}),
			])
			for (const res of [summaryRes, itemsRes, agingRes, balancesRes]) {
				if (!res.ok) throw new Error(await res.text())
			}
			setSummary(await summaryRes.json())
			setItems((await itemsRes.json()).items ?? [])
			setAging((await agingRes.json()).items ?? [])
			setBalances((await balancesRes.json()).items ?? [])
		} catch (e) {
			setError(
				e instanceof Error ? e.message : '売掛・買掛データの取得に失敗しました',
			)
		} finally {
			setLoading(false)
		}
	}, [asOf, headers, kind])

	useEffect(() => {
		fetchArAp()
	}, [fetchArAp])

	useEffect(() => {
		if (initialItemId) setSettlementItemId(initialItemId)
	}, [initialItemId])

	const createManual = async () => {
		setSaving(true)
		setError(null)
		try {
			const res = await fetch(`${BACKEND_URL}/v1/erp/ar-ap/items`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					kind: form.kind,
					sourceType: 'manual',
					sourceId: `manual-${Date.now()}`,
					sourceNumber: form.sourceNumber || undefined,
					counterpartyName: form.counterpartyName,
					issueDate: form.issueDate,
					dueDate: form.dueDate,
					totalAmount: Number(form.totalAmount),
				}),
			})
			if (!res.ok) throw new Error(await res.text())
			setForm(current => ({
				...current,
				counterpartyName: '',
				sourceNumber: '',
				totalAmount: '',
			}))
			await fetchArAp()
		} catch (e) {
			setError(e instanceof Error ? e.message : '発生登録に失敗しました')
		} finally {
			setSaving(false)
		}
	}

	const settle = async () => {
		if (!settlementItemId) return
		setSaving(true)
		setError(null)
		try {
			const res = await fetch(
				`${BACKEND_URL}/v1/erp/ar-ap/items/${settlementItemId}/settlements`,
				{
					method: 'POST',
					headers,
					body: JSON.stringify({
						settledOn: today(),
						amount: Number(settlementAmount),
						method: 'manual',
					}),
				},
			)
			if (!res.ok) throw new Error(await res.text())
			setSettlementAmount('')
			await fetchArAp()
		} catch (e) {
			setError(e instanceof Error ? e.message : '消込登録に失敗しました')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className='space-y-4'>
			<div className='flex flex-col gap-3 md:flex-row md:items-end md:justify-between'>
				<div>
					<h1 className='text-2xl font-semibold tracking-normal'>売掛・買掛</h1>
					<p className='text-sm text-muted-foreground'>
						請求残、支払予定、期日超過、取引先別残高を確認します。
					</p>
				</div>
				<div className='flex flex-wrap items-end gap-2'>
					<div className='space-y-1'>
						<Label htmlFor='arap-as-of'>基準日</Label>
						<Input
							id='arap-as-of'
							type='date'
							value={asOf}
							onChange={e => setAsOf(e.target.value)}
						/>
					</div>
					<div className='space-y-1'>
						<Label>種別</Label>
						<Select value={kind} onValueChange={setKind}>
							<SelectTrigger className='w-32'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='all'>すべて</SelectItem>
								<SelectItem value='receivable'>売掛</SelectItem>
								<SelectItem value='payable'>買掛</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Button variant='outline' onClick={fetchArAp} disabled={loading}>
						<RefreshCwIcon className='mr-2 h-4 w-4' />
						更新
					</Button>
				</div>
			</div>

			{error ? (
				<div className='rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
					{error}
				</div>
			) : null}

			<div className='grid gap-3 md:grid-cols-4'>
				<Card>
					<CardHeader>
						<CardTitle className='text-sm'>売掛残</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold'>
						{formatAmount(summary?.receivableOutstanding ?? 0)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className='text-sm'>売掛滞留</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold text-destructive'>
						{formatAmount(summary?.receivableOverdue ?? 0)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className='text-sm'>買掛残</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold'>
						{formatAmount(summary?.payableOutstanding ?? 0)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className='text-sm'>支払期限超過</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-semibold text-destructive'>
						{formatAmount(summary?.payableOverdue ?? 0)}
					</CardContent>
				</Card>
			</div>

			<div className='grid gap-4 xl:grid-cols-[1fr_360px]'>
				<Card>
					<CardHeader>
						<CardTitle>明細</CardTitle>
					</CardHeader>
					<CardContent>
						{loading ? (
							<div className='flex h-40 items-center justify-center text-muted-foreground'>
								<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
								読み込み中
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>種別</TableHead>
										<TableHead>取引先</TableHead>
										<TableHead>元伝票</TableHead>
										<TableHead>期日</TableHead>
										<TableHead>状態</TableHead>
										<TableHead className='text-right'>残額</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{items.map(item => (
										<TableRow
											key={item.id}
											className={
												item.id === initialItemId ? 'bg-amber-50' : undefined
											}
										>
											<TableCell>{kindLabel(item.kind)}</TableCell>
											<TableCell>{item.counterpartyName}</TableCell>
											<TableCell>
												{item.sourceNumber || item.sourceId}
											</TableCell>
											<TableCell>{item.dueDate}</TableCell>
											<TableCell>{statusBadge(item.effectiveStatus)}</TableCell>
											<TableCell className='text-right'>
												{formatAmount(item.outstandingAmount)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				<div className='space-y-4'>
					<Card>
						<CardHeader>
							<CardTitle>手入力発生</CardTitle>
						</CardHeader>
						<CardContent className='space-y-3'>
							<Select
								value={form.kind}
								onValueChange={value =>
									setForm(current => ({ ...current, kind: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='receivable'>売掛</SelectItem>
									<SelectItem value='payable'>買掛</SelectItem>
								</SelectContent>
							</Select>
							<Input
								placeholder='取引先名'
								value={form.counterpartyName}
								onChange={e =>
									setForm(current => ({
										...current,
										counterpartyName: e.target.value,
									}))
								}
							/>
							<Input
								placeholder='伝票番号'
								value={form.sourceNumber}
								onChange={e =>
									setForm(current => ({
										...current,
										sourceNumber: e.target.value,
									}))
								}
							/>
							<div className='grid grid-cols-2 gap-2'>
								<Input
									type='date'
									value={form.issueDate}
									onChange={e =>
										setForm(current => ({
											...current,
											issueDate: e.target.value,
										}))
									}
								/>
								<Input
									type='date'
									value={form.dueDate}
									onChange={e =>
										setForm(current => ({
											...current,
											dueDate: e.target.value,
										}))
									}
								/>
							</div>
							<Input
								inputMode='numeric'
								placeholder='金額'
								value={form.totalAmount}
								onChange={e =>
									setForm(current => ({
										...current,
										totalAmount: e.target.value,
									}))
								}
							/>
							<Button
								className='w-full'
								onClick={createManual}
								disabled={saving}
							>
								<PlusIcon className='mr-2 h-4 w-4' />
								登録
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>消込</CardTitle>
						</CardHeader>
						<CardContent className='space-y-3'>
							<Select
								value={settlementItemId}
								onValueChange={setSettlementItemId}
							>
								<SelectTrigger>
									<SelectValue placeholder='明細を選択' />
								</SelectTrigger>
								<SelectContent>
									{items
										.filter(item => item.outstandingAmount > 0)
										.map(item => (
											<SelectItem key={item.id} value={item.id}>
												{kindLabel(item.kind)} {item.counterpartyName}{' '}
												{formatAmount(item.outstandingAmount)}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
							<Input
								inputMode='numeric'
								placeholder='入金/支払額'
								value={settlementAmount}
								onChange={e => setSettlementAmount(e.target.value)}
							/>
							<Button
								className='w-full'
								variant='outline'
								onClick={settle}
								disabled={saving || !settlementItemId}
							>
								消込登録
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>

			<div className='grid gap-4 lg:grid-cols-2'>
				<Card>
					<CardHeader>
						<CardTitle>滞留</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>種別</TableHead>
									<TableHead>期間</TableHead>
									<TableHead className='text-right'>残額</TableHead>
									<TableHead className='text-right'>件数</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{aging.map(row => (
									<TableRow key={`${row.kind}-${row.bucket}`}>
										<TableCell>{kindLabel(row.kind)}</TableCell>
										<TableCell>{row.bucket}</TableCell>
										<TableCell className='text-right'>
											{formatAmount(row.amount)}
										</TableCell>
										<TableCell className='text-right'>
											{row.itemCount}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>取引先別残高</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>種別</TableHead>
									<TableHead>取引先</TableHead>
									<TableHead className='text-right'>残額</TableHead>
									<TableHead className='text-right'>滞留</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{balances.map(row => (
									<TableRow key={`${row.kind}-${row.counterpartyName}`}>
										<TableCell>{kindLabel(row.kind)}</TableCell>
										<TableCell>{row.counterpartyName}</TableCell>
										<TableCell className='text-right'>
											{formatAmount(row.outstandingAmount)}
										</TableCell>
										<TableCell className='text-right'>
											{formatAmount(row.overdueAmount)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
