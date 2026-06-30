import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { formatNanodollarAsUsd } from 'lib/format-price'

export type DailySalesPoint = {
	date: string
	totalNanodollar: string
	orderCount: number
}

const WIDTH = 720
const HEIGHT = 240
const PAD_LEFT = 56
const PAD_RIGHT = 16
const PAD_TOP = 16
const PAD_BOTTOM = 32

function nanoToUsd(nanodollars: string): number {
	const n = Number(nanodollars)
	if (Number.isNaN(n)) return 0
	return n / 1_000_000_000
}

function shortDateLabel(date: string): string {
	const [, m, d] = date.split('-')
	if (!m || !d) return date
	return `${Number(m)}/${Number(d)}`
}

export function DailySalesChart({ points }: { points: DailySalesPoint[] }) {
	if (points.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>日次売上</CardTitle>
					<CardDescription>
						選択期間内に確定済みの注文がありません。
					</CardDescription>
				</CardHeader>
				<CardContent className='h-40 flex items-center justify-center text-sm text-muted-foreground'>
					データなし
				</CardContent>
			</Card>
		)
	}

	const usdValues = points.map(p => nanoToUsd(p.totalNanodollar))
	const maxValue = Math.max(...usdValues, 1)
	const minValue = 0
	const xStep =
		points.length > 1 ? (WIDTH - PAD_LEFT - PAD_RIGHT) / (points.length - 1) : 0
	const yScale = (v: number) => {
		const range = maxValue - minValue || 1
		const ratio = (v - minValue) / range
		return HEIGHT - PAD_BOTTOM - ratio * (HEIGHT - PAD_TOP - PAD_BOTTOM)
	}
	const xAt = (i: number) =>
		points.length === 1 ? WIDTH / 2 : PAD_LEFT + i * xStep

	const linePath = points
		.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yScale(usdValues[i])}`)
		.join(' ')

	const areaPath = `${linePath} L ${xAt(points.length - 1)} ${HEIGHT - PAD_BOTTOM} L ${xAt(0)} ${HEIGHT - PAD_BOTTOM} Z`

	const yTicks = 4
	const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => {
		return (maxValue / yTicks) * i
	})

	const totalUsd = usdValues.reduce((a, b) => a + b, 0)
	const totalOrders = points.reduce((a, b) => a + b.orderCount, 0)

	const xLabelStep = Math.max(1, Math.ceil(points.length / 8))

	return (
		<Card>
			<CardHeader>
				<CardTitle>日次売上</CardTitle>
				<CardDescription>
					期間中の確定済み注文の売上推移（{points.length}日間）
				</CardDescription>
				<div className='mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground'>
					<span>
						合計:{' '}
						<span className='font-mono font-medium text-foreground'>
							{totalUsd.toLocaleString('en-US', {
								style: 'currency',
								currency: 'USD',
								minimumFractionDigits: 2,
								maximumFractionDigits: 2,
							})}
						</span>
					</span>
					<span>
						注文数:{' '}
						<span className='font-mono font-medium text-foreground'>
							{totalOrders.toLocaleString()}
						</span>
					</span>
				</div>
			</CardHeader>
			<CardContent>
				<div className='w-full overflow-x-auto'>
					<svg
						viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
						width='100%'
						height={HEIGHT}
						role='img'
						aria-label='日次売上の折れ線グラフ'
					>
						<title>日次売上推移</title>
						{yTickValues.map((tick, i) => (
							<g key={`grid-${i}`}>
								<line
									x1={PAD_LEFT}
									y1={yScale(tick)}
									x2={WIDTH - PAD_RIGHT}
									y2={yScale(tick)}
									stroke='currentColor'
									className='text-muted-foreground/20'
									strokeWidth={1}
								/>
								<text
									x={PAD_LEFT - 6}
									y={yScale(tick) + 4}
									textAnchor='end'
									className='fill-muted-foreground text-[10px]'
								>
									$
									{tick.toLocaleString('en-US', {
										maximumFractionDigits: 0,
									})}
								</text>
							</g>
						))}

						<path d={areaPath} className='fill-blue-500/15' stroke='none' />
						<path
							d={linePath}
							className='stroke-blue-600'
							fill='none'
							strokeWidth={2}
						/>
						{points.map((p, i) => (
							<circle
								key={p.date}
								cx={xAt(i)}
								cy={yScale(usdValues[i])}
								r={2.5}
								className='fill-blue-600'
							>
								<title>{`${p.date}: ${formatNanodollarAsUsd(p.totalNanodollar)} (${p.orderCount}件)`}</title>
							</circle>
						))}

						{points.map((p, i) => {
							if (i % xLabelStep !== 0 && i !== points.length - 1) return null
							return (
								<text
									key={`x-${p.date}`}
									x={xAt(i)}
									y={HEIGHT - 12}
									textAnchor='middle'
									className='fill-muted-foreground text-[10px]'
								>
									{shortDateLabel(p.date)}
								</text>
							)
						})}
					</svg>
				</div>
			</CardContent>
		</Card>
	)
}
