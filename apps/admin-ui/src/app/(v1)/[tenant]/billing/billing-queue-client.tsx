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
import { useToast } from 'components/ui/use-toast'
import { ExternalLinkIcon, MailIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import type {
	ActionResult,
	BillingFollowUpStatus,
	BillingQueueItem,
	InvoiceItem,
} from './types'

type QueueFilter = 'all' | 'overdue' | 'partially_paid' | 'exception'
type RowState = {
	status: 'success' | 'error' | 'pending'
	message: string
}

const followUpOptions: Array<{
	value: BillingFollowUpStatus
	label: string
}> = [
	{ value: 'not_started', label: '未着手' },
	{ value: 'contacted', label: '連絡済み' },
	{ value: 'payment_promised', label: '支払予定' },
	{ value: 'escalated', label: 'エスカレーション' },
	{ value: 'disputed', label: '異議あり' },
	{ value: 'resolved', label: '解決' },
]

function kindLabel(kind: BillingQueueItem['kind']) {
	return (
		{
			unpaid_invoice: '未払い請求',
			overdue_invoice: '期限超過',
			partially_paid: '一部入金',
			payment_link: '支払リンク',
			ar_receivable: 'AR残高',
			reconciliation_exception: '照合例外',
		}[kind] ?? kind
	)
}

function severityVariant(severity: BillingQueueItem['severity']) {
	if (severity === 'critical') return 'destructive' as const
	if (severity === 'warning') return 'outline' as const
	return 'secondary' as const
}

function followUpLabel(status?: BillingFollowUpStatus) {
	return (
		followUpOptions.find(option => option.value === status)?.label ?? '未着手'
	)
}

function formatAmount(value: number, currency = 'JPY') {
	return new Intl.NumberFormat('ja-JP', {
		currency,
		maximumFractionDigits: currency === 'JPY' ? 0 : 2,
		style: 'currency',
	}).format(value)
}

function formatDate(value?: string | null) {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat('ja-JP', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(date)
}

function isOverdueItem(item: BillingQueueItem) {
	if (item.kind === 'overdue_invoice') return true
	if (item.sourceType !== 'ar_receivable') return false
	if (!item.dueDate) return false
	return item.dueDate < new Date().toISOString().slice(0, 10)
}

export function filterBillingQueueItems(
	items: BillingQueueItem[],
	filter: QueueFilter,
) {
	if (filter === 'overdue') {
		return items.filter(isOverdueItem)
	}
	if (filter === 'partially_paid') {
		return items.filter(item => item.kind === 'partially_paid')
	}
	if (filter === 'exception') {
		return items.filter(item => item.kind === 'reconciliation_exception')
	}
	return items
}

export function BillingQueueClient({
	items,
	tenant,
	resendPaymentLink,
	updateFollowUpStatus,
}: {
	items: BillingQueueItem[]
	tenant: string
	resendPaymentLink: (invoiceId: string) => Promise<ActionResult<InvoiceItem>>
	updateFollowUpStatus: (
		invoiceId: string,
		status: BillingFollowUpStatus,
		note?: string,
	) => Promise<ActionResult<InvoiceItem>>
}) {
	const [filter, setFilter] = useState<QueueFilter>('all')
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const [rowStates, setRowStates] = useState<Record<string, RowState>>({})
	const [followUpOverrides, setFollowUpOverrides] = useState<
		Record<string, BillingFollowUpStatus>
	>({})
	const [isPending, startTransition] = useTransition()
	const { toast } = useToast()

	const visibleItems = useMemo(
		() => filterBillingQueueItems(items, filter),
		[items, filter],
	)
	const selectableItems = visibleItems.filter(item => item.canUpdateFollowUp)
	const allSelected =
		selectableItems.length > 0 &&
		selectableItems.every(item => selectedIds.has(item.id))
	const selectedItems = visibleItems.filter(item => selectedIds.has(item.id))

	function setRowState(itemId: string, state: RowState) {
		setRowStates(current => ({ ...current, [itemId]: state }))
	}

	function toggleItem(itemId: string, checked: boolean) {
		setSelectedIds(current => {
			const next = new Set(current)
			if (checked) next.add(itemId)
			else next.delete(itemId)
			return next
		})
	}

	function toggleAll(checked: boolean) {
		setSelectedIds(current => {
			const next = new Set(current)
			for (const item of selectableItems) {
				if (checked) next.add(item.id)
				else next.delete(item.id)
			}
			return next
		})
	}

	function resend(item: BillingQueueItem) {
		if (!item.invoiceId) return
		setRowState(item.id, { status: 'pending', message: '送信中' })
		startTransition(async () => {
			const result = await resendPaymentLink(item.invoiceId!)
			if (result.success) {
				setRowState(item.id, {
					status: 'success',
					message: '支払リンクを再送しました',
				})
				toast({
					title: '支払リンクを再送しました',
					description: item.title,
				})
				return
			}
			const message = result.message ?? '支払リンクの再送に失敗しました'
			setRowState(item.id, { status: 'error', message })
			toast({ title: '再送に失敗しました', description: message })
		})
	}

	function updateFollowUp(
		item: BillingQueueItem,
		status: BillingFollowUpStatus,
	) {
		if (!item.invoiceId) return
		setRowState(item.id, { status: 'pending', message: '更新中' })
		startTransition(async () => {
			const result = await updateFollowUpStatus(item.invoiceId!, status)
			if (result.success) {
				setFollowUpOverrides(current => ({ ...current, [item.id]: status }))
				setRowState(item.id, {
					status: 'success',
					message: `フォローアップを${followUpLabel(status)}に更新しました`,
				})
				toast({
					title: 'フォローアップを更新しました',
					description: `${item.title}: ${followUpLabel(status)}`,
				})
				return
			}
			const message = result.message ?? 'フォローアップ更新に失敗しました'
			setRowState(item.id, { status: 'error', message })
			toast({ title: '更新に失敗しました', description: message })
		})
	}

	function bulkUpdate(status: BillingFollowUpStatus) {
		const targets = selectedItems.filter(item => item.invoiceId)
		if (targets.length === 0) return
		startTransition(async () => {
			const results = await Promise.all(
				targets.map(async item => {
					setRowState(item.id, { status: 'pending', message: '更新中' })
					const result = await updateFollowUpStatus(item.invoiceId!, status)
					setRowState(item.id, {
						status: result.success ? 'success' : 'error',
						message: result.success
							? `フォローアップを${followUpLabel(status)}に更新しました`
							: (result.message ?? 'フォローアップ更新に失敗しました'),
					})
					if (result.success) {
						setFollowUpOverrides(current => ({ ...current, [item.id]: status }))
					}
					return result
				}),
			)
			const failed = results.filter(result => !result.success).length
			toast({
				title:
					failed === 0
						? '一括更新が完了しました'
						: `${failed}件の一括更新に失敗しました`,
				description: `${targets.length - failed}/${targets.length} 件更新`,
			})
		})
	}

	return (
		<Card>
			<CardHeader>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<CardTitle>Collection work queue</CardTitle>
						<p className='mt-1 text-sm text-muted-foreground'>
							{visibleItems.length} 件 / 選択 {selectedItems.length} 件
						</p>
					</div>
					<div className='flex flex-wrap items-center gap-2'>
						<Select
							value={filter}
							onValueChange={value => {
								setFilter(value as QueueFilter)
								setSelectedIds(new Set())
							}}
						>
							<SelectTrigger className='w-[180px]'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='all'>すべて</SelectItem>
								<SelectItem value='overdue'>期限超過</SelectItem>
								<SelectItem value='partially_paid'>一部入金</SelectItem>
								<SelectItem value='exception'>照合例外</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value='bulk'
							onValueChange={value =>
								bulkUpdate(value as BillingFollowUpStatus)
							}
							disabled={selectedItems.length === 0 || isPending}
						>
							<SelectTrigger className='w-[180px]'>
								<SelectValue placeholder='一括操作' />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='bulk' disabled>
									一括ステータス更新
								</SelectItem>
								{followUpOptions.map(option => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className='w-10'>
								<input
									type='checkbox'
									aria-label='表示中の請求行を選択'
									checked={allSelected}
									onChange={event => toggleAll(event.currentTarget.checked)}
								/>
							</TableHead>
							<TableHead>種別</TableHead>
							<TableHead>対象</TableHead>
							<TableHead>取引先</TableHead>
							<TableHead>状態</TableHead>
							<TableHead>回収状況</TableHead>
							<TableHead>期限/発生日</TableHead>
							<TableHead className='text-right'>金額</TableHead>
							<TableHead>操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{visibleItems.length === 0 ? (
							<TableRow>
								<TableCell colSpan={9} className='h-20 text-center'>
									条件に一致する回収・照合項目はありません。
								</TableCell>
							</TableRow>
						) : null}
						{visibleItems.map(item => {
							const rowState = rowStates[item.id]
							return (
								<TableRow key={item.id}>
									<TableCell>
										<input
											type='checkbox'
											aria-label={`${item.title} を選択`}
											checked={selectedIds.has(item.id)}
											disabled={!item.canUpdateFollowUp}
											onChange={event =>
												toggleItem(item.id, event.currentTarget.checked)
											}
										/>
									</TableCell>
									<TableCell>
										<Badge variant={severityVariant(item.severity)}>
											{kindLabel(item.kind)}
										</Badge>
									</TableCell>
									<TableCell>
										<div className='font-medium'>{item.title}</div>
										{item.detail ? (
											<div className='max-w-[320px] truncate text-xs text-muted-foreground'>
												{item.detail}
											</div>
										) : null}
										{rowState ? (
											<div
												className={
													rowState.status === 'error'
														? 'mt-1 text-xs text-destructive'
														: 'mt-1 text-xs text-muted-foreground'
												}
											>
												{rowState.message}
											</div>
										) : null}
									</TableCell>
									<TableCell>{item.counterparty ?? '-'}</TableCell>
									<TableCell>{item.status}</TableCell>
									<TableCell>
										{item.canUpdateFollowUp ? (
											<Select
												value={
													followUpOverrides[item.id] ??
													item.followUpStatus ??
													'not_started'
												}
												onValueChange={value =>
													updateFollowUp(item, value as BillingFollowUpStatus)
												}
												disabled={isPending}
											>
												<SelectTrigger className='w-[150px]'>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{followUpOptions.map(option => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										) : (
											<span className='text-sm text-muted-foreground'>-</span>
										)}
									</TableCell>
									<TableCell>
										{formatDate(item.dueDate ?? item.eventDate)}
									</TableCell>
									<TableCell className='text-right'>
										{formatAmount(item.amount, item.currency)}
									</TableCell>
									<TableCell>
										<div className='flex flex-wrap gap-2'>
											{item.canResendPaymentLink ? (
												<Button
													type='button'
													size='sm'
													variant='outline'
													onClick={() => resend(item)}
													disabled={isPending}
												>
													<MailIcon className='mr-1 h-3.5 w-3.5' />
													再送
												</Button>
											) : null}
											<Button size='sm' variant='outline' asChild>
												<Link href={`/${tenant}${item.href}` as Route}>
													<ExternalLinkIcon className='mr-1 h-3.5 w-3.5' />
													詳細
												</Link>
											</Button>
											{item.reconciliationHref ? (
												<Button size='sm' variant='ghost' asChild>
													<Link
														href={
															`/${tenant}${item.reconciliationHref}` as Route
														}
													>
														照合
													</Link>
												</Button>
											) : null}
										</div>
									</TableCell>
								</TableRow>
							)
						})}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	)
}
