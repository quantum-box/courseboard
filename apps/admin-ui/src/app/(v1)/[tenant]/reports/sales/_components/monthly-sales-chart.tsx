import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { formatNanodollarAsUsd } from 'lib/format-price'

export type MonthlySalesPoint = {
	yearMonth: string
	totalNanodollar: string
	orderCount: number
}

const WIDTH = 720
const HEIGHT = 240
const PAD_LEFT = 56
const PAD_RIGHT = 16
const PAD_TOP = 16
const PAD_BOTTOM = 36

function nanoToUsd(nanodollars: string): number {
	const n = Number(nanodollars)
	if (Number.isNaN(n)) return 0
	return n / 1_000_000_000
}

function shortMonthLabel(yearMonth: string): string {
	const [y, m] = yearMonth.split('-')
	if (!y || !m) return yearMonth
	return `${y.slice(2)}/${Number(m)}月`
}

export function MonthlySalesChart({
	points,
}: {
	points: MonthlySalesPoint[]
}) {
	if (points.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>月次売上</CardTitle>
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
	const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT
	const slot = innerWidth / points.length
	const barWidth = Math.max(8, slot * 0.6)
	const yScale = (v: number) => {
		const range = maxValue || 1
		const ratio = v / range
		return HEIGHT - PAD_BOTTOM - ratio * (HEIGHT - PAD_TOP - PAD_BOTTOM)
	}

	const yTicks = 4
	const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => {
		return (maxValue / yTicks) * i
	})

	const totalUsd = usdValues.reduce((a, b) => a + b, 0)
	const totalOrders = points.reduce((a, b) => a + b.orderCount, 0)

	return (
		<Card>
			<CardHeader>
				<CardTitle>月次売上</CardTitle>
				<CardDescription>
					月別の確定売上（{points.length}ヶ月分）
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
						aria-label='月次売上の棒グラフ'
					>
						<title>月次売上</title>
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

						{points.map((p, i) => {
							const cx = PAD_LEFT + slot * i + slot / 2
							const x = cx - barWidth / 2
							const y = yScale(usdValues[i])
							const h = HEIGHT - PAD_BOTTOM - y
							return (
								<g key={p.yearMonth}>
									<rect
										x={x}
										y={y}
										width={barWidth}
										height={Math.max(0, h)}
										className='fill-emerald-600'
										rx={2}
									>
										<title>{`${p.yearMonth}: ${formatNanodollarAsUsd(p.totalNanodollar)} (${p.orderCount}件)`}</title>
									</rect>
									<text
										x={cx}
										y={HEIGHT - 12}
										textAnchor='middle'
										className='fill-muted-foreground text-[10px]'
									>
										{shortMonthLabel(p.yearMonth)}
									</text>
								</g>
							)
						})}
					</svg>
				</div>
			</CardContent>
		</Card>
	)
}
