'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from 'components/ui/dropdown-menu'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import type { QuoteListItemFragment } from 'gen/graphql'
import { useCreateQuotePdfMutation } from 'gen/graphql-urql'
import { formatDate } from 'lib/date'
import { getServerModePrefix } from 'lib/mode'
import { useMutationError } from 'lib/utils/mutationError'
import {
	FileDownIcon,
	FileIcon,
	FilePlusIcon,
	ListFilterIcon,
	Loader2Icon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useMemo, useState } from 'react'

const currencyFormatter = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const statusLabels: Record<string, string> = {
	DRAFT: '下書き',
	PENDING_APPROVAL: '承認待ち',
	APPROVED: '承認済み',
	REJECTED: '差し戻し',
	APPROVAL_NOT_NEEDED: '承認不要',
}

const statusTabs = {
	all: 'すべて',
	active: 'アクティブ',
	draft: '下書き',
	archived: 'アーカイブ済み',
} as const

function formatCurrency(value: number) {
	return currencyFormatter.format(value)
}

function getStatusLabel(status: string) {
	return statusLabels[status] ?? status
}

function getLineItemsSummary(lineItems: QuoteListItemFragment['lineItems']) {
	if (lineItems.length === 0) {
		return '品目なし'
	}

	const itemNames = lineItems
		.slice(0, 2)
		.map(item => `${item.name} x${item.quantity}`)
	const suffix = lineItems.length > 2 ? ` 他${lineItems.length - 2}件` : ''
	return `${itemNames.join('、')}${suffix}`
}

function filterQuotes(
	quotes: QuoteListItemFragment[],
	filter?: string,
	query?: string,
) {
	const normalizedQuery = query?.trim().toLowerCase()
	return quotes.filter(quote => {
		const matchesFilter =
			!filter ||
			filter === 'all' ||
			(filter === 'draft' && quote.status === 'DRAFT') ||
			(filter === 'active' &&
				quote.status !== 'DRAFT' &&
				quote.status !== 'REJECTED') ||
			(filter === 'archived' && quote.status === 'REJECTED')

		if (!matchesFilter) {
			return false
		}

		if (!normalizedQuery) {
			return true
		}

		const searchTarget = [
			quote.id,
			quote.title,
			quote.status,
			quote.client?.name,
			...quote.lineItems.map(item => item.name),
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()

		return searchTarget.includes(normalizedQuery)
	})
}

export function QuotesList({
	data,
	searchParams: { filter, query },
	tenantId,
}: {
	data: QuoteListItemFragment[]
	searchParams: {
		filter?: string
		query?: string
	}
	tenantId: string
}) {
	const [exportingQuoteId, setExportingQuoteId] = useState<string | null>(null)
	const [{ fetching }, createQuotePdf] = useCreateQuotePdfMutation()
	const { toast, errorToast } = useMutationError()
	const modePrefix = getServerModePrefix(tenantId)
	const currentTab =
		filter && filter in statusTabs ? (filter as keyof typeof statusTabs) : 'all'
	const [selectedTab, setSelectedTab] =
		useState<keyof typeof statusTabs>(currentTab)
	const filteredQuotes = useMemo(
		() => filterQuotes(data, selectedTab, query),
		[data, selectedTab, query],
	)

	const handleCreatePdf = async (quoteId: string) => {
		setExportingQuoteId(quoteId)
		try {
			const result = await createQuotePdf({ quoteId })
			if (result.error) {
				throw result.error
			}

			const signedUrl = result.data?.createQuotePdf.signedUrl
			if (!signedUrl) {
				throw new Error('PDF URL was not returned')
			}

			window.open(signedUrl, '_blank', 'noopener,noreferrer')
			toast({
				title: 'PDFを出力しました',
				description: '見積書PDFを新しいタブで開きました。',
			})
		} catch (error: unknown) {
			errorToast('PDF出力に失敗しました', error)
		} finally {
			setExportingQuoteId(null)
		}
	}

	const renderTable = (quotes: QuoteListItemFragment[]) => (
		<Card>
			<CardHeader>
				<CardTitle>見積もり</CardTitle>
				<CardDescription>
					見積書の明細と金額を確認し、PDFを出力できます。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className='min-w-[180px]'>見積</TableHead>
							<TableHead className='hidden lg:table-cell'>取引先</TableHead>
							<TableHead>ステータス</TableHead>
							<TableHead className='hidden xl:table-cell'>品目</TableHead>
							<TableHead className='hidden md:table-cell text-right'>
								小計
							</TableHead>
							<TableHead className='hidden md:table-cell text-right'>
								税
							</TableHead>
							<TableHead className='text-right'>合計</TableHead>
							<TableHead className='hidden lg:table-cell'>受注日</TableHead>
							<TableHead className='text-right'>請求</TableHead>
							<TableHead className='text-right'>PDF</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{quotes.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={10}
									className='h-24 text-center text-muted-foreground'
								>
									表示できる見積はありません。
								</TableCell>
							</TableRow>
						)}
						{quotes.map(quote => {
							const isExporting = exportingQuoteId === quote.id
							return (
								<TableRow key={quote.id}>
									<TableCell>
										<div className='space-y-1'>
											<Link
												href={
													`${modePrefix}/${tenantId}/library/quotes/${quote.id}` as Route
												}
												className='font-medium hover:underline'
											>
												{quote.title || quote.id}
											</Link>
											<div className='text-xs text-muted-foreground'>
												{quote.id}
											</div>
										</div>
									</TableCell>
									<TableCell className='hidden lg:table-cell'>
										{quote.client?.name ?? quote.clientId ?? '-'}
									</TableCell>
									<TableCell>
										<Badge variant='outline'>
											{getStatusLabel(quote.status)}
										</Badge>
									</TableCell>
									<TableCell className='hidden xl:table-cell max-w-[280px]'>
										<div className='truncate text-sm'>
											{getLineItemsSummary(quote.lineItems)}
										</div>
										<div className='text-xs text-muted-foreground'>
											{quote.lineItems.length}品目
										</div>
									</TableCell>
									<TableCell className='hidden md:table-cell text-right'>
										{formatCurrency(quote.subtotal)}
									</TableCell>
									<TableCell className='hidden md:table-cell text-right'>
										{formatCurrency(quote.tax)}
									</TableCell>
									<TableCell className='text-right font-medium'>
										{formatCurrency(quote.total)}
									</TableCell>
									<TableCell className='hidden lg:table-cell'>
										{formatDate(quote.orderDate)}
									</TableCell>
									<TableCell className='text-right'>
										<Button variant='ghost' size='icon' asChild>
											<Link
												href={
													`${modePrefix}/${tenantId}/invoices/new?quoteId=${quote.id}` as Route
												}
												aria-label='請求書を作成'
											>
												<FilePlusIcon className='h-4 w-4' />
											</Link>
										</Button>
									</TableCell>
									<TableCell className='text-right'>
										<Button
											type='button'
											size='sm'
											variant='outline'
											className='h-8 gap-1'
											disabled={fetching || exportingQuoteId !== null}
											onClick={() => handleCreatePdf(quote.id)}
										>
											{isExporting ? (
												<Loader2Icon className='h-3.5 w-3.5 animate-spin' />
											) : (
												<FileDownIcon className='h-3.5 w-3.5' />
											)}
											<span className='hidden sm:inline'>
												{isExporting ? '出力中' : 'PDF 出力'}
											</span>
										</Button>
									</TableCell>
								</TableRow>
							)
						})}
					</TableBody>
				</Table>
			</CardContent>
			<CardFooter>
				<div className='text-xs text-muted-foreground'>
					<strong>{filteredQuotes.length}</strong> /{' '}
					<strong>{data.length}</strong> 件の見積を表示しています
				</div>
			</CardFooter>
		</Card>
	)

	return (
		<Tabs
			value={selectedTab}
			onValueChange={value => setSelectedTab(value as keyof typeof statusTabs)}
		>
			<div className='flex items-center'>
				<TabsList className='hidden sm:flex'>
					{Object.entries(statusTabs).map(([value, label]) => (
						<TabsTrigger key={value} value={value}>
							{label}
						</TabsTrigger>
					))}
				</TabsList>
				<div className='ml-auto flex items-center gap-2'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button className='h-8 gap-1' size='sm' variant='outline'>
								<ListFilterIcon className='h-3.5 w-3.5' />
								<span className='sr-only sm:not-sr-only sm:whitespace-nowrap'>
									フィルタ
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							<DropdownMenuLabel>フィルタリング</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={selectedTab === 'active'}
								onSelect={() => setSelectedTab('active')}
							>
								アクティブ
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem
								checked={selectedTab === 'draft'}
								onSelect={() => setSelectedTab('draft')}
							>
								下書き
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem
								checked={selectedTab === 'archived'}
								onSelect={() => setSelectedTab('archived')}
							>
								アーカイブ済み
							</DropdownMenuCheckboxItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button className='h-8 gap-1' size='sm' variant='outline'>
						<FileIcon className='h-3.5 w-3.5' />
						<span className='sr-only sm:not-sr-only sm:whitespace-nowrap'>
							エクスポート
						</span>
					</Button>
				</div>
			</div>
			{Object.keys(statusTabs).map(tab => (
				<TabsContent key={tab} value={tab}>
					{renderTable(filteredQuotes)}
				</TabsContent>
			))}
		</Tabs>
	)
}
