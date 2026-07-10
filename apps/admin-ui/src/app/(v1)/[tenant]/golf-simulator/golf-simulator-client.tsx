'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
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
import { CalculatorIcon, LineChartIcon, Loader2Icon } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import {
	calculateGolfFeeAction,
	simulateGolfRangeAction,
	type CalculateGolfResult,
	type SimulateRangeResult,
} from './action'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const numberFormat = new Intl.NumberFormat('ja-JP')

type FormStatus<T> = {
	result: T | null
	error: string | null
}

export function GolfSimulatorClient() {
	const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
	const nextMonth = useMemo(() => {
		const date = new Date()
		date.setMonth(date.getMonth() + 1)
		return date.toISOString().slice(0, 10)
	}, [])
	const [calculateStatus, setCalculateStatus] =
		useState<FormStatus<CalculateGolfResult>>({
			result: null,
			error: null,
		})
	const [rangeStatus, setRangeStatus] = useState<FormStatus<SimulateRangeResult>>(
		{
			result: null,
			error: null,
		},
	)
	const [isCalculating, startCalculateTransition] = useTransition()
	const [isSimulating, startSimulateTransition] = useTransition()

	function submitCalculate(formData: FormData) {
		setCalculateStatus({ result: null, error: null })
		startCalculateTransition(async () => {
			const result = await calculateGolfFeeAction({
				greenFee: toNumber(formData.get('greenFee')),
				numHoles: formData.get('numHoles') === '9' ? 9 : 18,
				cartFee: toOptionalNumber(formData.get('cartFee')),
				caddyFee: toOptionalNumber(formData.get('caddyFee')),
			})
			if (result.success) {
				setCalculateStatus({ result: result.data, error: null })
			} else {
				setCalculateStatus({ result: null, error: result.message })
			}
		})
	}

	function submitRange(formData: FormData) {
		setRangeStatus({ result: null, error: null })
		startSimulateTransition(async () => {
			const result = await simulateGolfRangeAction({
				dateFrom: String(formData.get('dateFrom') ?? ''),
				dateTo: String(formData.get('dateTo') ?? ''),
				numVisitorsMin: toNumber(formData.get('numVisitorsMin')),
				numVisitorsMax: toNumber(formData.get('numVisitorsMax')),
				avgGreenFee: toNumber(formData.get('avgGreenFee')),
			})
			if (result.success) {
				setRangeStatus({ result: result.data, error: null })
			} else {
				setRangeStatus({ result: null, error: result.message })
			}
		})
	}

	return (
		<div className='grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]'>
			<Card>
				<CardHeader>
					<div className='flex items-center justify-between gap-3'>
						<div>
							<CardTitle className='flex items-center gap-2 text-lg'>
								<CalculatorIcon className='h-5 w-5' />
								料金計算
							</CardTitle>
							<CardDescription>
								グリーンフィーから等級とゴルフ場利用税を計算します。
							</CardDescription>
						</div>
						<Badge variant='outline'>POST /calculate</Badge>
					</div>
				</CardHeader>
				<CardContent>
					<form action={submitCalculate} className='grid gap-4'>
						<div className='grid gap-4 md:grid-cols-2'>
							<Field label='グリーンフィー' htmlFor='greenFee'>
								<Input
									id='greenFee'
									name='greenFee'
									type='number'
									min={1}
									step={1}
									defaultValue={8000}
									required
								/>
							</Field>
							<Field label='ホール数' htmlFor='numHoles'>
								<Select name='numHoles' defaultValue='18'>
									<SelectTrigger id='numHoles'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='18'>18 holes</SelectItem>
										<SelectItem value='9'>9 holes</SelectItem>
									</SelectContent>
								</Select>
							</Field>
							<Field label='カート料金' htmlFor='cartFee'>
								<Input
									id='cartFee'
									name='cartFee'
									type='number'
									min={0}
									step={1}
									placeholder='任意'
								/>
							</Field>
							<Field label='キャディ料金' htmlFor='caddyFee'>
								<Input
									id='caddyFee'
									name='caddyFee'
									type='number'
									min={0}
									step={1}
									placeholder='任意'
								/>
							</Field>
						</div>
						<Button type='submit' disabled={isCalculating}>
							{isCalculating ? (
								<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
							) : (
								<CalculatorIcon className='mr-2 h-4 w-4' />
							)}
							計算する
						</Button>
					</form>

					{calculateStatus.error ? (
						<ErrorMessage message={calculateStatus.error} />
					) : null}
					{calculateStatus.result ? (
						<CalculateResult result={calculateStatus.result} />
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className='flex items-center justify-between gap-3'>
						<div>
							<CardTitle className='flex items-center gap-2 text-lg'>
								<LineChartIcon className='h-5 w-5' />
								売上幅シミュレーション
							</CardTitle>
							<CardDescription>
								期間と来場者幅から売上幅を算出し、API の損益行も表示します。
							</CardDescription>
						</div>
						<Badge variant='outline'>POST /simulate/range</Badge>
					</div>
				</CardHeader>
				<CardContent>
					<form action={submitRange} className='grid gap-4'>
						<div className='grid gap-4 md:grid-cols-2'>
							<Field label='開始日' htmlFor='dateFrom'>
								<Input
									id='dateFrom'
									name='dateFrom'
									type='date'
									defaultValue={today}
									required
								/>
							</Field>
							<Field label='終了日' htmlFor='dateTo'>
								<Input
									id='dateTo'
									name='dateTo'
									type='date'
									defaultValue={nextMonth}
									required
								/>
							</Field>
							<Field label='来場者数 min' htmlFor='numVisitorsMin'>
								<Input
									id='numVisitorsMin'
									name='numVisitorsMin'
									type='number'
									min={0}
									step={1}
									defaultValue={60}
									required
								/>
							</Field>
							<Field label='来場者数 max' htmlFor='numVisitorsMax'>
								<Input
									id='numVisitorsMax'
									name='numVisitorsMax'
									type='number'
									min={0}
									step={1}
									defaultValue={120}
									required
								/>
							</Field>
							<div className='md:col-span-2'>
								<Field label='平均グリーンフィー' htmlFor='avgGreenFee'>
									<Input
										id='avgGreenFee'
										name='avgGreenFee'
										type='number'
										min={1}
										step={1}
										defaultValue={8000}
										required
									/>
								</Field>
							</div>
						</div>
						<Button type='submit' disabled={isSimulating}>
							{isSimulating ? (
								<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
							) : (
								<LineChartIcon className='mr-2 h-4 w-4' />
							)}
							シミュレーションする
						</Button>
					</form>

					{rangeStatus.error ? (
						<ErrorMessage message={rangeStatus.error} />
					) : null}
					{rangeStatus.result ? <RangeResult result={rangeStatus.result} /> : null}
				</CardContent>
			</Card>
		</div>
	)
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string
	htmlFor: string
	children: React.ReactNode
}) {
	return (
		<div className='grid gap-2'>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
		</div>
	)
}

function ErrorMessage({ message }: { message: string }) {
	return (
		<div className='mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
			{message}
		</div>
	)
}

function CalculateResult({ result }: { result: CalculateGolfResult }) {
	return (
		<div className='mt-5 grid gap-3'>
			<div className='grid gap-3 sm:grid-cols-4'>
				<ResultTile label='等級' value={result.courseGrade} />
				<ResultTile label='税率換算' value={`${result.taxRate.toFixed(2)}%`} />
				<ResultTile label='税額' value={yen.format(result.taxAmount)} />
				<ResultTile label='合計' value={yen.format(result.total)} />
			</div>
			<div className='rounded-md border'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Player</TableHead>
							<TableHead>Tax</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{result.breakdown.map(item => (
							<TableRow key={item.player_index}>
								<TableCell>{item.player_index + 1}</TableCell>
								<TableCell>{yen.format(item.fee)}</TableCell>
								<TableCell>
									{item.exempt ? `Exempt: ${item.reason ?? '-'}` : 'Taxable'}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

function RangeResult({ result }: { result: SimulateRangeResult }) {
	return (
		<div className='mt-5 grid gap-3'>
			<div className='grid gap-3 sm:grid-cols-3'>
				<ResultTile
					label='売上 min'
					value={yen.format(result.projectedRevenueMin)}
				/>
				<ResultTile
					label='売上 max'
					value={yen.format(result.projectedRevenueMax)}
				/>
				<ResultTile label='税額 max' value={yen.format(result.taxTotal)} />
			</div>
			<p className='text-xs text-muted-foreground'>対象期間: {result.periodLabel}</p>
			<div className='overflow-x-auto rounded-md border'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Green fee</TableHead>
							<TableHead>Grade</TableHead>
							<TableHead className='text-right'>Visitors</TableHead>
							<TableHead className='text-right'>Revenue</TableHead>
							<TableHead className='text-right'>Tax total</TableHead>
							<TableHead className='text-right'>Profit</TableHead>
							<TableHead className='text-right'>Margin</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{result.rows.map(row => (
							<TableRow key={`${row.greenFee}-${row.visitors}`}>
								<TableCell>{yen.format(row.greenFee)}</TableCell>
								<TableCell>{row.courseGrade}</TableCell>
								<TableCell className='text-right'>
									{numberFormat.format(row.visitors)}
								</TableCell>
								<TableCell className='text-right'>
									{yen.format(row.revenue)}
								</TableCell>
								<TableCell className='text-right'>
									{yen.format(row.taxTotal)}
								</TableCell>
								<TableCell className='text-right'>
									{yen.format(row.profit)}
								</TableCell>
								<TableCell className='text-right'>
									{row.profitMarginPct.toFixed(1)}%
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

function ResultTile({ label, value }: { label: string; value: string }) {
	return (
		<div className='rounded-md border bg-muted/30 p-3'>
			<p className='text-xs text-muted-foreground'>{label}</p>
			<p className='mt-1 text-lg font-semibold'>{value}</p>
		</div>
	)
}

function toNumber(value: FormDataEntryValue | null) {
	return Number(value ?? 0)
}

function toOptionalNumber(value: FormDataEntryValue | null) {
	if (value === null || String(value).trim() === '') return undefined
	return Number(value)
}
