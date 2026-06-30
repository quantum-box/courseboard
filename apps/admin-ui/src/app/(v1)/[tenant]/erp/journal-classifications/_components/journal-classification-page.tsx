'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { Input } from 'components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { CheckIcon, RefreshCwIcon, SaveIcon } from 'lucide-react'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { useCallback, useEffect, useMemo, useState } from 'react'

type JournalCandidate = {
	id: string
	transactionId: string
	sourceKind: string
	accountItemId: string
	taxCode: string
	confidence: number
	reviewRequired: boolean
	status: 'pending' | 'approved' | 'rejected'
	createdAt: string
}

type Draft = {
	accountItemId: string
	taxCode: string
	confidence: string
}

const BACKEND_URL = getBackendBaseUrl()

function statusBadge(candidate: JournalCandidate) {
	if (candidate.status === 'approved') {
		return <Badge variant='secondary'>承認済み</Badge>
	}
	if (candidate.reviewRequired) {
		return <Badge variant='destructive'>要レビュー</Badge>
	}
	return <Badge variant='outline'>未承認</Badge>
}

function confidenceLabel(value: number) {
	return `${Math.round(value * 100)}%`
}

export function JournalClassificationPage({
	tenant,
	accessToken,
}: {
	tenant: string
	accessToken: string
}) {
	const [items, setItems] = useState<JournalCandidate[]>([])
	const [drafts, setDrafts] = useState<Record<string, Draft>>({})
	const [loading, setLoading] = useState(true)
	const [savingId, setSavingId] = useState<string | null>(null)
	const [statusFilter, setStatusFilter] = useState('pending')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const headers = useMemo(
		() => ({
			'x-operator-id': tenant,
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		}),
		[accessToken, tenant],
	)

	const fetchItems = useCallback(async () => {
		setLoading(true)
		setErrorMessage(null)
		try {
			const params = new URLSearchParams()
			if (statusFilter !== 'all') params.set('status', statusFilter)
			const response = await fetch(
				`${BACKEND_URL}/v1/field/accounting/journal-classification-candidates?${params}`,
				{ headers },
			)
			if (!response.ok) {
				setItems([])
				setErrorMessage('仕訳候補を取得できませんでした')
				return
			}
			const data = await response.json()
			const nextItems = (data.items ?? []) as JournalCandidate[]
			setItems(nextItems)
			setDrafts(
				Object.fromEntries(
					nextItems.map(item => [
						item.id,
						{
							accountItemId: item.accountItemId,
							taxCode: item.taxCode,
							confidence: String(item.confidence),
						},
					]),
				),
			)
		} catch {
			setItems([])
			setErrorMessage('仕訳候補を取得できませんでした')
		} finally {
			setLoading(false)
		}
	}, [headers, statusFilter])

	useEffect(() => {
		void fetchItems()
	}, [fetchItems])

	const updateDraft = (id: string, patch: Partial<Draft>) => {
		setDrafts(prev => {
			const current = prev[id] ?? {
				accountItemId: '',
				taxCode: '',
				confidence: '0.8',
			}
			return {
				...prev,
				[id]: {
					...current,
					...patch,
				},
			}
		})
	}

	const modify = async (item: JournalCandidate) => {
		const draft = drafts[item.id]
		if (!draft) return
		setSavingId(item.id)
		setErrorMessage(null)
		try {
			const response = await fetch(
				`${BACKEND_URL}/v1/field/accounting/journal-classification-candidates/${item.id}`,
				{
					method: 'PATCH',
					headers,
					body: JSON.stringify({
						accountItemId: draft.accountItemId,
						taxCode: draft.taxCode,
						confidence: Number(draft.confidence),
					}),
				},
			)
			if (!response.ok) {
				setErrorMessage('仕訳候補を保存できませんでした')
				return
			}
			await fetchItems()
		} catch {
			setErrorMessage('仕訳候補を保存できませんでした')
		} finally {
			setSavingId(null)
		}
	}

	const approve = async (item: JournalCandidate) => {
		setSavingId(item.id)
		setErrorMessage(null)
		try {
			const response = await fetch(
				`${BACKEND_URL}/v1/field/accounting/journal-classification-candidates/${item.id}/approve`,
				{ method: 'POST', headers },
			)
			if (!response.ok) {
				setErrorMessage('仕訳候補を承認できませんでした')
				return
			}
			await fetchItems()
		} catch {
			setErrorMessage('仕訳候補を承認できませんでした')
		} finally {
			setSavingId(null)
		}
	}

	const reviewCount = items.filter(item => item.reviewRequired).length

	return (
		<div className='space-y-6'>
			<div className='flex flex-wrap items-start justify-between gap-3'>
				<div>
					<h1 className='text-xl font-bold'>仕訳候補レビュー</h1>
					<p className='text-sm text-muted-foreground'>
						Agent classification candidates / DB write only
					</p>
				</div>
				<div className='flex gap-2'>
					<Button
						variant={statusFilter === 'pending' ? 'default' : 'outline'}
						onClick={() => setStatusFilter('pending')}
					>
						未承認
					</Button>
					<Button
						variant={statusFilter === 'all' ? 'default' : 'outline'}
						onClick={() => setStatusFilter('all')}
					>
						すべて
					</Button>
					<Button variant='outline' onClick={() => void fetchItems()}>
						<RefreshCwIcon className='mr-2 size-4' />
						更新
					</Button>
				</div>
			</div>

			<div className='grid gap-4 md:grid-cols-3'>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>候補数</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-bold'>
						{items.length}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>要レビュー</CardTitle>
					</CardHeader>
					<CardContent className='text-2xl font-bold'>
						{reviewCount}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>Phase 1</CardTitle>
					</CardHeader>
					<CardContent className='text-sm text-muted-foreground'>
						freee POST なし
					</CardContent>
				</Card>
			</div>

			{errorMessage ? (
				<div
					className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'
					role='alert'
				>
					{errorMessage}
				</div>
			) : null}

			<Card>
				<CardContent className='pt-6'>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>取引</TableHead>
								<TableHead>候補</TableHead>
								<TableHead>信頼度</TableHead>
								<TableHead>状態</TableHead>
								<TableHead className='w-[180px]'>操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{loading ? (
								<TableRow>
									<TableCell colSpan={5}>読み込み中...</TableCell>
								</TableRow>
							) : items.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5}>候補はありません</TableCell>
								</TableRow>
							) : (
								items.map(item => {
									const draft = drafts[item.id] ?? {
										accountItemId: item.accountItemId,
										taxCode: item.taxCode,
										confidence: String(item.confidence),
									}
									return (
										<TableRow key={item.id}>
											<TableCell>
												<div className='font-medium'>{item.transactionId}</div>
												<div className='text-xs text-muted-foreground'>
													{item.sourceKind} /{' '}
													{new Date(item.createdAt).toLocaleString()}
												</div>
											</TableCell>
											<TableCell>
												<div className='grid gap-2 md:grid-cols-2'>
													<Input
														value={draft.accountItemId}
														onChange={event =>
															updateDraft(item.id, {
																accountItemId: event.target.value,
															})
														}
														aria-label='account item'
													/>
													<Input
														value={draft.taxCode}
														onChange={event =>
															updateDraft(item.id, {
																taxCode: event.target.value,
															})
														}
														aria-label='tax code'
													/>
												</div>
											</TableCell>
											<TableCell>
												<Input
													className='w-24'
													value={draft.confidence}
													onChange={event =>
														updateDraft(item.id, {
															confidence: event.target.value,
														})
													}
													aria-label='confidence'
												/>
												<div className='text-xs text-muted-foreground'>
													{confidenceLabel(item.confidence)}
												</div>
											</TableCell>
											<TableCell>{statusBadge(item)}</TableCell>
											<TableCell>
												<div className='flex gap-2'>
													<Button
														size='icon'
														variant='outline'
														disabled={savingId === item.id}
														onClick={() => void modify(item)}
														title='修正を保存'
													>
														<SaveIcon className='size-4' />
													</Button>
													<Button
														size='icon'
														disabled={savingId === item.id}
														onClick={() => void approve(item)}
														title='承認'
													>
														<CheckIcon className='size-4' />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									)
								})
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	)
}
