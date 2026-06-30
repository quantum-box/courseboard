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
	ArrowDownIcon,
	ArrowUpIcon,
	Loader2Icon,
	RefreshCwIcon,
} from 'lucide-react'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'

type ProfitTrend = {
	period: string
	date: string
	sales: number
	purchase: number
	gross_profit: number
	gross_margin_pct: number
}

type SupplierCost = {
	supplier_name: string
	total_cost: number
	entry_count: number
}

type ProductProfit = {
	product_name: string
	sales_total: number
	purchase_total: number
	gross_profit: number
	gross_margin_pct: number
}

type ProfitSummary = {
	period: string
	sales_total: number
	purchase_total: number
	gross_profit: number
	gross_margin_pct: number
	comparison: {
		sales_total_delta: number
		purchase_total_delta: number
		gross_profit_delta: number
		gross_margin_pct_delta: number
	}
	by_period: ProfitTrend[]
	by_day: ProfitTrend[]
	supplier_costs: SupplierCost[]
	by_product: ProductProfit[]
}

type ProfitDashboardPageProps = {
	tenant: string
	accessToken: string
}

const BACKEND_URL = getBackendBaseUrl()
const supplierColors = ['#0f766e', '#2563eb', '#9333ea', '#f59e0b', '#dc2626']

function monthStart() {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function today() {
	return new Date().toISOString().slice(0, 10)
}

function formatAmount(value: number) {
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0,
	}).format(value)
}

function formatPercent(value: number) {
	return `${value.toFixed(1)}%`
}

function DeltaBadge({
	value,
	inverse = false,
}: { value: number; inverse?: boolean }) {
	const positive = inverse ? value <= 0 : value >= 0
	const Icon = positive ? ArrowUpIcon : ArrowDownIcon
	return (
		<Badge variant={positive ? 'secondary' : 'destructive'} className='gap-1'>
			<Icon className='h-3 w-3' />
			{value >= 0 ? '+' : ''}
			{Math.round(value).toLocaleString('ja-JP')}
		</Badge>
	)
}

function KpiCard({
	title,
	value,
	delta,
	inverseDelta = false,
	secondary,
}: {
	title: string
	value: string
	delta: number
	inverseDelta?: boolean
	secondary?: string
}) {
	return (
		<Card>
			<CardHeader className='pb-2'>
				<CardTitle className='text-sm font-medium text-muted-foreground'>
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className='space-y-2'>
				<div className='text-2xl font-semibold tabular-nums'>{value}</div>
				<div className='flex items-center gap-2 text-xs text-muted-foreground'>
					<DeltaBadge value={delta} inverse={inverseDelta} />
					<span>{secondary ?? '前期間比'}</span>
				</div>
			</CardContent>
		</Card>
	)
}

export function ProfitDashboardPage({
	tenant,
	accessToken,
}: ProfitDashboardPageProps) {
	const [summary, setSummary] = useState<ProfitSummary | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day')
	const [dateFrom, setDateFrom] = useState(monthStart)
	const [dateTo, setDateTo] = useState(today)

	const headers = useMemo(
		() => ({
			'x-operator-id': tenant,
			Authorization: `Bearer ${accessToken}`,
		}),
		[accessToken, tenant],
	)

	const fetchSummary = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const params = new URLSearchParams({
				group_by: groupBy,
				date_from: dateFrom,
				date_to: dateTo,
			})
			const res = await fetch(
				`${BACKEND_URL}/v1/erp/profit-summary?${params}`,
				{ headers },
			)
			if (!res.ok) throw new Error(await res.text())
			setSummary(await res.json())
		} catch (e) {
			const message =
				e instanceof Error ? e.message : '粗利サマリの取得に失敗しました'
			setError(message)
			setSummary(null)
		} finally {
			setLoading(false)
		}
	}, [dateFrom, dateTo, groupBy, headers])

	useEffect(() => {
		fetchSummary()
	}, [fetchSummary])

	const chartData = summary?.by_period ?? []
	const supplierData = summary?.supplier_costs ?? []
	const productRows = summary?.by_product ?? []

	return (
		<div className='space-y-6'>
			<div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
				<div>
					<h1 className='text-2xl font-bold'>ERPダッシュボード</h1>
					<p className='text-sm text-muted-foreground'>
						売上台帳と仕入台帳から粗利を集計します
					</p>
				</div>
				<div className='grid gap-3 sm:grid-cols-4'>
					<div className='space-y-1'>
						<Label htmlFor='profit-date-from'>開始日</Label>
						<Input
							id='profit-date-from'
							type='date'
							value={dateFrom}
							onChange={event => setDateFrom(event.target.value)}
						/>
					</div>
					<div className='space-y-1'>
						<Label htmlFor='profit-date-to'>終了日</Label>
						<Input
							id='profit-date-to'
							type='date'
							value={dateTo}
							onChange={event => setDateTo(event.target.value)}
						/>
					</div>
					<div className='space-y-1'>
						<Label>集計単位</Label>
						<Select
							value={groupBy}
							onValueChange={value =>
								setGroupBy(value as 'day' | 'week' | 'month')
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='day'>日別</SelectItem>
								<SelectItem value='week'>週別</SelectItem>
								<SelectItem value='month'>月別</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Button
						className='self-end'
						onClick={fetchSummary}
						disabled={loading}
					>
						{loading ? (
							<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
						) : (
							<RefreshCwIcon className='mr-2 h-4 w-4' />
						)}
						更新
					</Button>
				</div>
			</div>

			{error ? (
				<Card className='border-destructive'>
					<CardContent className='pt-6 text-sm text-destructive'>
						{error}
					</CardContent>
				</Card>
			) : null}

			<div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
				<KpiCard
					title='売上'
					value={formatAmount(summary?.sales_total ?? 0)}
					delta={summary?.comparison.sales_total_delta ?? 0}
				/>
				<KpiCard
					title='原価'
					value={formatAmount(summary?.purchase_total ?? 0)}
					delta={summary?.comparison.purchase_total_delta ?? 0}
					inverseDelta
				/>
				<KpiCard
					title='粗利'
					value={formatAmount(summary?.gross_profit ?? 0)}
					delta={summary?.comparison.gross_profit_delta ?? 0}
				/>
				<KpiCard
					title='粗利率'
					value={formatPercent(summary?.gross_margin_pct ?? 0)}
					delta={summary?.comparison.gross_margin_pct_delta ?? 0}
					secondary='前期間比 pt'
				/>
			</div>

			<div className='grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]'>
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>粗利推移</CardTitle>
					</CardHeader>
					<CardContent className='h-[320px]'>
						{loading ? (
							<div className='flex h-full items-center justify-center'>
								<Loader2Icon className='h-5 w-5 animate-spin' />
							</div>
						) : chartData.length === 0 ? (
							<div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
								集計データがありません
							</div>
						) : (
							<ResponsiveContainer width='100%' height='100%'>
								<LineChart data={chartData}>
									<CartesianGrid strokeDasharray='3 3' />
									<XAxis dataKey='period' />
									<YAxis tickFormatter={value => `${Number(value) / 1000}k`} />
									<Tooltip
										formatter={(value, name) => [
											formatAmount(Number(value)),
											name,
										]}
									/>
									<Legend />
									<Line
										type='monotone'
										dataKey='sales'
										name='売上'
										stroke='#2563eb'
										strokeWidth={2}
									/>
									<Line
										type='monotone'
										dataKey='purchase'
										name='原価'
										stroke='#f59e0b'
										strokeWidth={2}
									/>
									<Line
										type='monotone'
										dataKey='gross_profit'
										name='粗利'
										stroke='#0f766e'
										strokeWidth={2}
									/>
								</LineChart>
							</ResponsiveContainer>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className='text-base'>仕入先別コスト</CardTitle>
					</CardHeader>
					<CardContent className='h-[320px]'>
						{supplierData.length === 0 ? (
							<div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
								集計データがありません
							</div>
						) : (
							<ResponsiveContainer width='100%' height='100%'>
								<PieChart>
									<Tooltip formatter={value => formatAmount(Number(value))} />
									<Pie
										data={supplierData}
										dataKey='total_cost'
										nameKey='supplier_name'
										outerRadius={110}
										label={({ name }) => name}
									>
										{supplierData.map((entry, index) => (
											<Cell
												key={entry.supplier_name}
												fill={supplierColors[index % supplierColors.length]}
											/>
										))}
									</Pie>
								</PieChart>
							</ResponsiveContainer>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className='text-base'>商品別粗利</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>商品</TableHead>
								<TableHead className='text-right'>売上</TableHead>
								<TableHead className='text-right'>原価</TableHead>
								<TableHead className='text-right'>粗利</TableHead>
								<TableHead className='text-right'>粗利率</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{productRows.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className='py-8 text-center text-muted-foreground'
									>
										集計データがありません
									</TableCell>
								</TableRow>
							) : (
								productRows.map(row => (
									<TableRow key={row.product_name}>
										<TableCell className='font-medium'>
											{row.product_name}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{formatAmount(row.sales_total)}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{formatAmount(row.purchase_total)}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{formatAmount(row.gross_profit)}
										</TableCell>
										<TableCell className='text-right tabular-nums'>
											{formatPercent(row.gross_margin_pct)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	)
}
