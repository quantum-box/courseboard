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
import {
	ArrowDownUpIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	RefreshCwIcon,
	SearchIcon,
} from 'lucide-react'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import {
	type EvidenceSearchFilter,
	type EvidenceSearchItem,
	searchEvidenceAction,
} from '../actions'

type Props = {
	tenant: string
	initialItems: EvidenceSearchItem[]
	initialLimit: number
	initialOffset: number
	initialSortBy: string
	initialSortDirection: string
	initialFilter?: Partial<FilterState>
	initialMessage?: string
}

type FilterState = {
	transactionDateFrom: string
	transactionDateTo: string
	amountMin: string
	amountMax: string
	counterparty: string
	voucherType: string
	status: string
	taxCategory: string
	sourceModule: string
	sourceId: string
	journalEntryId: string
	fileHash: string
	ocrReviewStatus: string
	auditAction: string
	auditDateFrom: string
	auditDateTo: string
	verificationStatus: string
	sortBy: string
	sortDirection: string
}

const ALL_VALUE = 'all'
const PAGE_SIZE = 50

const VOUCHER_TYPES = [
	['invoice', '請求書'],
	['receipt', '領収書'],
	['delivery_slip', '納品書'],
	['purchase_order', '発注書'],
	['payment_statement', '支払明細'],
	['expense_receipt', '経費領収書'],
	['ocr_attachment', 'OCR添付'],
	['other_tax_document', 'その他税務証憑'],
]

const REVIEW_STATUSES = [
	['unreviewed', '未レビュー'],
	['needs_review', '要レビュー'],
	['accepted', 'レビュー済み'],
	['corrected', '補正済み'],
	['rejected', '差し戻し'],
]

const LINK_ROLE_LABELS: Record<string, string> = {
	primary_voucher: '主証憑',
	supporting_document: '補助資料',
	tax_evidence: '税務証憑',
	payment_proof: '支払証跡',
	delivery_slip: '納品書',
	settlement_proof: '決済証跡',
	reconciliation_support: '照合資料',
}

const STATUS_LABELS: Record<string, string> = {
	active: '有効',
	draft: '下書き',
	pending_review: '確認待ち',
	verified: '検証済み',
	superseded: '差替済み',
	logically_deleted: '論理削除',
	archived: '保管済み',
}

function labelFor(value: string, fallback: Record<string, string>) {
	return fallback[value] ?? value
}

function formatAmount(amount?: string | null, currency = 'JPY') {
	if (!amount) return '-'
	const value = Number(amount)
	if (!Number.isFinite(value)) return amount
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency,
		maximumFractionDigits: currency === 'JPY' ? 0 : 2,
	}).format(value)
}

function formatDateTime(value?: string | null) {
	if (!value) return '-'
	return new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(new Date(value))
}

function toApiDateTime(date: string, boundary: 'start' | 'end') {
	if (!date) return undefined
	const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999'
	return new Date(`${date}T${time}+09:00`).toISOString()
}

function buildApiFilter(state: FilterState, offset: number): EvidenceSearchFilter {
	return {
		transactionDateFrom: state.transactionDateFrom,
		transactionDateTo: state.transactionDateTo,
		amountMin: state.amountMin,
		amountMax: state.amountMax,
		counterparty: state.counterparty,
		voucherType: state.voucherType === ALL_VALUE ? undefined : state.voucherType,
		status: state.status || undefined,
		taxCategory: state.taxCategory,
		sourceModule: state.sourceModule,
		sourceId: state.sourceId,
		journalEntryId: state.journalEntryId,
		fileHash: state.fileHash,
		ocrReviewStatus:
			state.ocrReviewStatus === ALL_VALUE ? undefined : state.ocrReviewStatus,
		auditAction: state.auditAction === ALL_VALUE ? undefined : state.auditAction,
		auditDateFrom: toApiDateTime(state.auditDateFrom, 'start'),
		auditDateTo: toApiDateTime(state.auditDateTo, 'end'),
		verificationStatus:
			state.verificationStatus === ALL_VALUE
				? undefined
				: state.verificationStatus,
		sortBy: state.sortBy,
		sortDirection: state.sortDirection,
		limit: PAGE_SIZE,
		offset,
	}
}

export function EvidenceSearchPage({
	tenant,
	initialItems,
	initialLimit,
	initialOffset,
	initialSortBy,
	initialSortDirection,
	initialFilter,
	initialMessage,
}: Props) {
	const mp = getServerModePrefix(tenant)
	const [items, setItems] = useState(initialItems)
	const [limit, setLimit] = useState(initialLimit)
	const [offset, setOffset] = useState(initialOffset)
	const [filters, setFilters] = useState<FilterState>({
		transactionDateFrom: '',
		transactionDateTo: '',
		amountMin: '',
		amountMax: '',
		counterparty: '',
		voucherType: ALL_VALUE,
		status: '',
		taxCategory: '',
		sourceModule: '',
		sourceId: '',
		journalEntryId: '',
		fileHash: '',
		ocrReviewStatus: ALL_VALUE,
		auditAction: ALL_VALUE,
		auditDateFrom: '',
		auditDateTo: '',
		verificationStatus: ALL_VALUE,
		sortBy: initialSortBy,
		sortDirection: initialSortDirection,
		...initialFilter,
	})
	const [isLoading, setIsLoading] = useState(false)
	const [message, setMessage] = useState<string | null>(initialMessage ?? null)

	const activeFilterCount = useMemo(
		() =>
			Object.entries(filters).filter(([key, value]) => {
				if (key === 'sortBy' || key === 'sortDirection') return false
				return value && value !== ALL_VALUE
			}).length,
		[filters],
	)

	const load = useCallback(
		async (nextOffset: number) => {
			setIsLoading(true)
			setMessage(null)
			const result = await searchEvidenceAction(
				tenant,
				buildApiFilter(filters, nextOffset),
			)
			setIsLoading(false)
			if (!result.success || !result.data) {
				setMessage(result.message ?? '証憑検索に失敗しました')
				return
			}
			setItems(result.data.items)
			setLimit(result.data.limit)
			setOffset(result.data.offset)
		},
		[filters, tenant],
	)

	return (
		<div className='space-y-4'>
			<div className='flex flex-wrap items-center justify-between gap-3'>
				<div>
					<h1 className='text-xl font-semibold tracking-normal'>証憑</h1>
					<p className='text-sm text-muted-foreground'>
						検索結果 {items.length} 件 / 表示開始 {offset + 1}
					</p>
				</div>
				<div className='flex items-center gap-2'>
					<Badge variant='secondary'>条件 {activeFilterCount}</Badge>
					<Button
						type='button'
						variant='outline'
						size='sm'
						onClick={() => load(offset)}
						disabled={isLoading}
					>
						<RefreshCwIcon className='mr-2 h-4 w-4' />
						再読込
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader className='pb-3'>
					<CardTitle className='flex items-center gap-2 text-base'>
						<SearchIcon className='h-4 w-4' />
						検索
					</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4'>
					<div className='grid gap-3 md:grid-cols-4'>
						<div className='space-y-1.5'>
							<Label>取引日 From</Label>
							<Input
								type='date'
								value={filters.transactionDateFrom}
								onChange={event =>
									setFilters(current => ({
										...current,
										transactionDateFrom: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>取引日 To</Label>
							<Input
								type='date'
								value={filters.transactionDateTo}
								onChange={event =>
									setFilters(current => ({
										...current,
										transactionDateTo: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>金額 Min</Label>
							<Input
								inputMode='decimal'
								value={filters.amountMin}
								onChange={event =>
									setFilters(current => ({
										...current,
										amountMin: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>金額 Max</Label>
							<Input
								inputMode='decimal'
								value={filters.amountMax}
								onChange={event =>
									setFilters(current => ({
										...current,
										amountMax: event.target.value,
									}))
								}
							/>
						</div>
					</div>

					<div className='grid gap-3 md:grid-cols-4'>
						<div className='space-y-1.5'>
							<Label>取引先</Label>
							<Input
								value={filters.counterparty}
								onChange={event =>
									setFilters(current => ({
										...current,
										counterparty: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>証憑種別</Label>
							<Select
								value={filters.voucherType}
								onValueChange={value =>
									setFilters(current => ({ ...current, voucherType: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_VALUE}>すべて</SelectItem>
									{VOUCHER_TYPES.map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className='space-y-1.5'>
							<Label>税区分</Label>
							<Input
								placeholder='taxable_10'
								value={filters.taxCategory}
								onChange={event =>
									setFilters(current => ({
										...current,
										taxCategory: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>OCRレビュー</Label>
							<Select
								value={filters.ocrReviewStatus}
								onValueChange={value =>
									setFilters(current => ({ ...current, ocrReviewStatus: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_VALUE}>すべて</SelectItem>
									{REVIEW_STATUSES.map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className='grid gap-3 md:grid-cols-4'>
						<div className='space-y-1.5'>
							<Label>source_type</Label>
							<Input
								value={filters.sourceModule}
								onChange={event =>
									setFilters(current => ({
										...current,
										sourceModule: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>source_id</Label>
							<Input
								value={filters.sourceId}
								onChange={event =>
									setFilters(current => ({
										...current,
										sourceId: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>journal_entry_id</Label>
							<Input
								value={filters.journalEntryId}
								onChange={event =>
									setFilters(current => ({
										...current,
										journalEntryId: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>hash</Label>
							<Input
								value={filters.fileHash}
								onChange={event =>
									setFilters(current => ({
										...current,
										fileHash: event.target.value,
									}))
								}
							/>
						</div>
					</div>

					<div className='grid gap-3 md:grid-cols-5'>
						<div className='space-y-1.5'>
							<Label>監査 action</Label>
							<Select
								value={filters.auditAction}
								onValueChange={value =>
									setFilters(current => ({ ...current, auditAction: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_VALUE}>すべて</SelectItem>
									{[
										'uploaded',
										'metadata_corrected',
										'file_replaced',
										'linked',
										'unlinked',
										'hash_verified',
										'hash_mismatch',
										'logically_deleted',
										'restored',
									].map(value => (
										<SelectItem key={value} value={value}>
											{value}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className='space-y-1.5'>
							<Label>監査日 From</Label>
							<Input
								type='date'
								value={filters.auditDateFrom}
								onChange={event =>
									setFilters(current => ({
										...current,
										auditDateFrom: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>監査日 To</Label>
							<Input
								type='date'
								value={filters.auditDateTo}
								onChange={event =>
									setFilters(current => ({
										...current,
										auditDateTo: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>ソート</Label>
							<Select
								value={filters.sortBy}
								onValueChange={value =>
									setFilters(current => ({ ...current, sortBy: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='transaction_date'>取引日</SelectItem>
									<SelectItem value='created_at'>登録日</SelectItem>
									<SelectItem value='retention_until'>保存期限</SelectItem>
									<SelectItem value='amount'>金額</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className='space-y-1.5'>
							<Label>方向</Label>
							<Select
								value={filters.sortDirection}
								onValueChange={value =>
									setFilters(current => ({ ...current, sortDirection: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='desc'>降順</SelectItem>
									<SelectItem value='asc'>昇順</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className='flex items-center justify-between gap-3'>
						{message ? (
							<p className='text-sm text-destructive'>{message}</p>
						) : (
							<span />
						)}
						<Button type='button' onClick={() => load(0)} disabled={isLoading}>
							<ArrowDownUpIcon className='mr-2 h-4 w-4' />
							検索
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className='p-0'>
					<div className='overflow-x-auto'>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className='min-w-[130px]'>取引日</TableHead>
									<TableHead className='min-w-[180px]'>証憑</TableHead>
									<TableHead className='min-w-[180px]'>取引先</TableHead>
									<TableHead className='min-w-[130px] text-right'>金額</TableHead>
									<TableHead className='min-w-[160px]'>状態</TableHead>
									<TableHead className='min-w-[220px]'>リンク</TableHead>
									<TableHead className='min-w-[180px]'>監査</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{items.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className='h-24 text-center'>
											証憑がありません
										</TableCell>
									</TableRow>
								) : (
									items.map(item => (
										<TableRow key={item.evidence.id}>
											<TableCell>{item.evidence.transactionDate}</TableCell>
											<TableCell>
												<Link
													className='font-medium text-primary underline-offset-4 hover:underline'
													href={
														`${mp}/${tenant}/erp/evidence/${item.evidence.id}` as Route
													}
												>
													{item.evidence.documentNumber ?? item.evidence.id}
												</Link>
												<div className='mt-1 text-xs text-muted-foreground'>
													{item.evidence.voucherType} /{' '}
													{item.evidence.originalFileName ?? '-'}
												</div>
											</TableCell>
											<TableCell>
												<div>{item.evidence.counterparty ?? '-'}</div>
												<div className='text-xs text-muted-foreground'>
													{item.evidence.taxCategory ?? '-'}
												</div>
											</TableCell>
											<TableCell className='text-right tabular-nums'>
												{formatAmount(
													item.evidence.amount,
													item.evidence.currency,
												)}
											</TableCell>
											<TableCell>
												<div className='flex flex-wrap gap-1'>
													<Badge variant='secondary'>
														{labelFor(item.evidence.status, STATUS_LABELS)}
													</Badge>
													<Badge variant='outline'>
														{item.evidence.verificationStatus}
													</Badge>
												</div>
											</TableCell>
											<TableCell>
												<div className='flex flex-wrap gap-1'>
													{item.linkedSources.slice(0, 3).map(link => (
														<Badge
															key={`${link.sourceType}-${link.sourceId}-${link.linkRole}`}
															variant='outline'
														>
															{labelFor(link.linkRole, LINK_ROLE_LABELS)}:{' '}
															{link.sourceType}
														</Badge>
													))}
													{item.linkedSources.length > 3 ? (
														<Badge variant='outline'>
															+{item.linkedSources.length - 3}
														</Badge>
													) : null}
												</div>
											</TableCell>
											<TableCell>
												<div className='text-sm'>
													{item.auditSummary.latestAction ?? '-'}
												</div>
												<div className='text-xs text-muted-foreground'>
													{formatDateTime(item.auditSummary.latestAt)}
												</div>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			<div className='flex items-center justify-end gap-2'>
				<Button
					type='button'
					variant='outline'
					size='sm'
					disabled={offset === 0 || isLoading}
					onClick={() => load(Math.max(offset - limit, 0))}
				>
					<ChevronLeftIcon className='mr-2 h-4 w-4' />
					前へ
				</Button>
				<Button
					type='button'
					variant='outline'
					size='sm'
					disabled={items.length < limit || isLoading}
					onClick={() => load(offset + limit)}
				>
					次へ
					<ChevronRightIcon className='ml-2 h-4 w-4' />
				</Button>
			</div>
		</div>
	)
}
