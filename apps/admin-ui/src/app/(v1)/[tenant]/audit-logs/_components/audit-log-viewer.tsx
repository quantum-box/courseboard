'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent } from 'components/ui/card'
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
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	DownloadIcon,
	FilterIcon,
	RefreshCwIcon,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
	type AuditLog,
	type AuditLogFilter,
	exportAuditLogSummaryPdfAction,
	exportAuditLogsAction,
	fetchAuditLogsAction,
} from '../actions'

type Props = {
	tenantId: string
	initialItems: AuditLog[]
	initialNextCursor: string | null
	initialFilter?: Pick<AuditLogFilter, 'resourceType' | 'resourceId' | 'action'>
}

type FilterState = {
	fromDate: string
	toDate: string
	resourceType: string
	resourceId: string
	action: string
	actorId: string
}

const ALL_VALUE = 'all'

const RESOURCE_TYPE_OPTIONS = [
	{ value: ALL_VALUE, label: 'すべて' },
	{ value: 'product', label: '商品' },
	{ value: 'inventory', label: '在庫' },
	{ value: 'order', label: '注文' },
	{ value: 'invoice', label: '請求書' },
	{ value: 'customer', label: '顧客' },
	{ value: 'payment', label: '入金' },
	{ value: 'iam_role', label: 'IAMロール' },
	{ value: 'erp_endpoint', label: 'ERPエンドポイント' },
	{ value: 'tenant', label: 'テナント' },
	{ value: 'api_key', label: 'APIキー' },
]

const ACTION_OPTIONS = [
	{ value: ALL_VALUE, label: 'すべて' },
	{ value: 'create', label: '作成' },
	{ value: 'update', label: '更新' },
	{ value: 'delete', label: '削除' },
	{ value: 'receive', label: '入庫' },
	{ value: 'adjust', label: '調整' },
	{ value: 'cancel', label: 'キャンセル' },
	{ value: 'close', label: '締め' },
	{ value: 'reopen', label: '再オープン' },
	{ value: 'erp:invoices:create', label: '請求書作成' },
	{ value: 'erp:invoices:update', label: '請求書更新' },
	{ value: 'erp:invoices:delete', label: '請求書削除' },
	{ value: 'erp:customers:create', label: '顧客作成' },
	{ value: 'erp:customers:update', label: '顧客更新' },
	{ value: 'erp:customers:delete', label: '顧客削除' },
	{ value: 'erp:orders:status_change', label: '受注ステータス変更' },
	{ value: 'erp:payments:reconcile', label: '入金消込' },
	{ value: 'erp:settings:update', label: '設定更新' },
	{ value: 'iam:role:assign', label: 'ロール付与' },
	{ value: 'iam:role:revoke', label: 'ロール剥奪' },
	{ value: 'erp:access:denied', label: 'アクセス拒否' },
]

function toApiDate(date: string, boundary: 'start' | 'end') {
	if (!date) return undefined
	const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999'
	return new Date(`${date}T${time}+09:00`).toISOString()
}

function buildFilter(state: FilterState, cursor?: string): AuditLogFilter {
	return {
		from: toApiDate(state.fromDate, 'start'),
		to: toApiDate(state.toDate, 'end'),
		resourceType:
			state.resourceType === ALL_VALUE ? undefined : state.resourceType,
		resourceId: state.resourceId,
		action: state.action === ALL_VALUE ? undefined : state.action,
		actorId: state.actorId,
		cursor,
		limit: 50,
	}
}

function formatJstDateTime(value: string) {
	return new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).format(new Date(value))
}

function getActionLabel(action: string) {
	const option = ACTION_OPTIONS.find(item => item.value === action)
	if (option) return option.label

	const labels: Record<string, string> = {
		upsert: '登録・更新',
		revoke: '無効化',
		export: 'エクスポート',
		import: 'インポート',
	}
	return labels[action] ?? action
}

function getResourceTypeLabel(resourceType: string) {
	return (
		RESOURCE_TYPE_OPTIONS.find(item => item.value === resourceType)?.label ??
		resourceType
	)
}

function stringifyJson(value: unknown) {
	if (value === null || value === undefined) return '差分はありません'
	if (typeof value === 'string') return value
	return JSON.stringify(value, null, 2)
}

function downloadBase64File(
	base64: string,
	filename: string,
	contentType: string,
) {
	const binary = window.atob(base64)
	const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
	const blob = new Blob([bytes], { type: contentType })
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(url)
}

export function AuditLogViewer({
	tenantId,
	initialItems,
	initialNextCursor,
	initialFilter,
}: Props) {
	const [filters, setFilters] = useState<FilterState>({
		fromDate: '',
		toDate: '',
		resourceType: initialFilter?.resourceType ?? ALL_VALUE,
		resourceId: initialFilter?.resourceId ?? '',
		action: initialFilter?.action ?? ALL_VALUE,
		actorId: '',
	})
	const [items, setItems] = useState(initialItems)
	const [nextCursor, setNextCursor] = useState(initialNextCursor)
	const [cursorStack, setCursorStack] = useState<string[]>([])
	const [currentCursor, setCurrentCursor] = useState<string | undefined>()
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
	const [isLoading, setIsLoading] = useState(false)
	const [isExporting, setIsExporting] = useState(false)
	const [isExportingPdf, setIsExportingPdf] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const activeFilterCount = useMemo(
		() =>
			[
				filters.fromDate,
				filters.toDate,
				filters.actorId,
				filters.resourceId,
				filters.resourceType !== ALL_VALUE ? filters.resourceType : '',
				filters.action !== ALL_VALUE ? filters.action : '',
			].filter(Boolean).length,
		[filters],
	)

	const loadLogs = useCallback(
		async (cursor?: string) => {
			setIsLoading(true)
			setErrorMessage(null)
			try {
				const result = await fetchAuditLogsAction(
					tenantId,
					buildFilter(filters, cursor),
				)
				if (!result.success || !result.data) {
					setErrorMessage(result.message ?? '監査ログの取得に失敗しました')
					return
				}
				setItems(result.data.items)
				setNextCursor(result.data.nextCursor)
				setCurrentCursor(cursor)
				setExpandedIds(new Set())
			} finally {
				setIsLoading(false)
			}
		},
		[filters, tenantId],
	)

	useEffect(() => {
		setItems(initialItems)
		setNextCursor(initialNextCursor)
	}, [initialItems, initialNextCursor])

	const handleApplyFilters = async () => {
		setCursorStack([])
		await loadLogs()
	}

	const handleResetFilters = async () => {
		const resetFilters = {
			fromDate: '',
			toDate: '',
			resourceType: ALL_VALUE,
			resourceId: '',
			action: ALL_VALUE,
			actorId: '',
		}
		setFilters(resetFilters)
		setCursorStack([])
		setCurrentCursor(undefined)
		setIsLoading(true)
		setErrorMessage(null)
		try {
			const result = await fetchAuditLogsAction(
				tenantId,
				buildFilter(resetFilters),
			)
			if (!result.success || !result.data) {
				setErrorMessage(result.message ?? '監査ログの取得に失敗しました')
				return
			}
			setItems(result.data.items)
			setNextCursor(result.data.nextCursor)
			setExpandedIds(new Set())
		} finally {
			setIsLoading(false)
		}
	}

	const handleNext = async () => {
		if (!nextCursor) return
		setCursorStack(stack => [...stack, currentCursor ?? ''])
		await loadLogs(nextCursor)
	}

	const handlePrevious = async () => {
		if (cursorStack.length === 0) return
		const previous = cursorStack[cursorStack.length - 1]
		setCursorStack(stack => stack.slice(0, -1))
		await loadLogs(previous || undefined)
	}

	const handleExport = async () => {
		setIsExporting(true)
		setErrorMessage(null)
		try {
			const result = await exportAuditLogsAction(
				tenantId,
				buildFilter(filters, undefined),
			)
			if (!result.success || !result.data) {
				setErrorMessage(result.message ?? 'CSV出力に失敗しました')
				return
			}
			downloadBase64File(
				result.data.base64,
				result.data.filename,
				result.data.contentType,
			)
		} finally {
			setIsExporting(false)
		}
	}

	const handleExportPdf = async () => {
		setIsExportingPdf(true)
		setErrorMessage(null)
		try {
			const result = await exportAuditLogSummaryPdfAction(
				tenantId,
				buildFilter(filters, undefined),
			)
			if (!result.success || !result.data) {
				setErrorMessage(result.message ?? 'PDF出力に失敗しました')
				return
			}
			downloadBase64File(
				result.data.base64,
				result.data.filename,
				result.data.contentType,
			)
		} finally {
			setIsExportingPdf(false)
		}
	}

	const toggleExpanded = (id: string) => {
		setExpandedIds(current => {
			const next = new Set(current)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	return (
		<div className='grid gap-4'>
			<Card>
				<CardContent className='grid gap-4 p-4 sm:p-6'>
					<div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-6'>
						<div className='grid min-w-0 gap-2'>
							<Label htmlFor='audit-log-from'>開始日</Label>
							<Input
								id='audit-log-from'
								type='date'
								value={filters.fromDate}
								onChange={event =>
									setFilters(current => ({
										...current,
										fromDate: event.target.value,
									}))
								}
							/>
						</div>
						<div className='grid min-w-0 gap-2'>
							<Label htmlFor='audit-log-to'>終了日</Label>
							<Input
								id='audit-log-to'
								type='date'
								value={filters.toDate}
								onChange={event =>
									setFilters(current => ({
										...current,
										toDate: event.target.value,
									}))
								}
							/>
						</div>
						<div className='grid min-w-0 gap-2'>
							<Label>リソース</Label>
							<Select
								value={filters.resourceType}
								onValueChange={value =>
									setFilters(current => ({ ...current, resourceType: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{RESOURCE_TYPE_OPTIONS.map(option => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className='grid min-w-0 gap-2'>
							<Label>操作</Label>
							<Select
								value={filters.action}
								onValueChange={value =>
									setFilters(current => ({ ...current, action: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ACTION_OPTIONS.map(option => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className='grid min-w-0 gap-2'>
							<Label htmlFor='audit-log-resource-id'>対象ID</Label>
							<Input
								id='audit-log-resource-id'
								value={filters.resourceId}
								placeholder='inv_... / cus_...'
								className='font-mono'
								onChange={event =>
									setFilters(current => ({
										...current,
										resourceId: event.target.value,
									}))
								}
							/>
						</div>
						<div className='grid min-w-0 gap-2'>
							<Label htmlFor='audit-log-actor'>Actor ID</Label>
							<Input
								id='audit-log-actor'
								value={filters.actorId}
								placeholder='us_...'
								className='font-mono'
								onChange={event =>
									setFilters(current => ({
										...current,
										actorId: event.target.value,
									}))
								}
							/>
						</div>
					</div>

					<div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
						<div className='flex items-center gap-2 text-sm text-muted-foreground'>
							<FilterIcon className='h-4 w-4' />
							<span>{activeFilterCount} 件のフィルタを適用中</span>
						</div>
						<div className='flex flex-wrap gap-2'>
							<Button
								type='button'
								variant='outline'
								onClick={handleResetFilters}
								disabled={isLoading}
							>
								リセット
							</Button>
							<Button
								type='button'
								variant='outline'
								onClick={handleExport}
								disabled={isExporting}
							>
								<DownloadIcon className='mr-2 h-4 w-4' />
								CSV
							</Button>
							<Button
								type='button'
								variant='outline'
								onClick={handleExportPdf}
								disabled={isExportingPdf}
							>
								<DownloadIcon className='mr-2 h-4 w-4' />
								PDF
							</Button>
							<Button
								type='button'
								onClick={handleApplyFilters}
								disabled={isLoading}
							>
								<RefreshCwIcon
									className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
								/>
								検索
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{errorMessage && (
				<div className='rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
					{errorMessage}
				</div>
			)}

			<Card className='overflow-hidden'>
				<CardContent className='p-0'>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className='min-w-[150px]'>日時(JST)</TableHead>
								<TableHead className='min-w-[170px]'>Actor</TableHead>
								<TableHead className='min-w-[220px]'>対象</TableHead>
								<TableHead className='min-w-[120px]'>操作</TableHead>
								<TableHead className='w-[72px] text-right'>詳細</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className='py-10 text-center text-muted-foreground'
									>
										監査ログがありません
									</TableCell>
								</TableRow>
							) : (
								items.map(item => {
									const isExpanded = expandedIds.has(item.id)
									const DetailIcon = isExpanded
										? ChevronUpIcon
										: ChevronDownIcon

									return (
										<Fragment key={item.id}>
											<TableRow key={item.id}>
												<TableCell className='whitespace-nowrap text-sm'>
													{formatJstDateTime(item.createdAt)}
												</TableCell>
												<TableCell>
													<div className='min-w-0'>
														<div className='truncate font-mono text-xs'>
															{item.actorId}
														</div>
														<div className='mt-1 text-xs text-muted-foreground'>
															{item.actorType}
														</div>
													</div>
												</TableCell>
												<TableCell>
													<div className='min-w-0'>
														<div className='text-sm font-medium'>
															{getResourceTypeLabel(item.resourceType)}
														</div>
														<div className='mt-1 break-all font-mono text-xs text-muted-foreground'>
															{item.resourceType}:{item.resourceId}
														</div>
													</div>
												</TableCell>
												<TableCell>
													<Badge variant='secondary' className='max-w-full'>
														<span className='truncate'>
															{getActionLabel(item.action)}
														</span>
													</Badge>
													<div className='mt-1 break-all font-mono text-xs text-muted-foreground'>
														{item.action}
													</div>
												</TableCell>
												<TableCell className='text-right'>
													<Button
														type='button'
														variant='ghost'
														size='icon'
														className='h-8 w-8'
														aria-expanded={isExpanded}
														onClick={() => toggleExpanded(item.id)}
													>
														<DetailIcon className='h-4 w-4' />
														<span className='sr-only'>diff詳細</span>
													</Button>
												</TableCell>
											</TableRow>
											{isExpanded && (
												<TableRow key={`${item.id}-detail`}>
													<TableCell colSpan={5} className='bg-muted/30'>
														<div className='grid gap-3 lg:grid-cols-2'>
															<div className='min-w-0'>
																<div className='mb-2 text-xs font-semibold text-muted-foreground'>
																	Diff
																</div>
																<pre className='max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-xs'>
																	{stringifyJson(item.diff)}
																</pre>
															</div>
															<div className='min-w-0'>
																<div className='mb-2 text-xs font-semibold text-muted-foreground'>
																	Metadata
																</div>
																<pre className='max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-xs'>
																	{stringifyJson(item.metadata)}
																</pre>
															</div>
														</div>
													</TableCell>
												</TableRow>
											)}
										</Fragment>
									)
								})
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
				<p className='text-sm text-muted-foreground'>{items.length} 件表示中</p>
				<div className='flex gap-2'>
					<Button
						type='button'
						variant='outline'
						onClick={handlePrevious}
						disabled={isLoading || cursorStack.length === 0}
					>
						<ChevronLeftIcon className='mr-2 h-4 w-4' />
						前へ
					</Button>
					<Button
						type='button'
						variant='outline'
						onClick={handleNext}
						disabled={isLoading || !nextCursor}
					>
						次へ
						<ChevronRightIcon className='ml-2 h-4 w-4' />
					</Button>
				</div>
			</div>
		</div>
	)
}
