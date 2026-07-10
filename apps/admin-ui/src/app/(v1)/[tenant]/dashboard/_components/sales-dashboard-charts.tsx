'use client'

import {
	Bar,
	BarChart,
	CartesianGrid,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import type { SalesDashboardData } from '../action'

const compactJpy = new Intl.NumberFormat('ja-JP', {
	notation: 'compact',
	maximumFractionDigits: 1,
})

function formatAmount(value: number) {
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0,
	}).format(value)
}

export function MonthlySalesChart({
	data,
}: {
	data: SalesDashboardData['monthlySales']
}) {
	return (
		<ResponsiveContainer width='100%' height='100%'>
			<BarChart data={data}>
				<CartesianGrid strokeDasharray='3 3' vertical={false} />
				<XAxis dataKey='month' tickLine={false} axisLine={false} />
				<YAxis
					tickLine={false}
					axisLine={false}
					tickFormatter={value => compactJpy.format(Number(value))}
				/>
				<Tooltip formatter={value => formatAmount(Number(value))} />
				<Legend />
				<Bar
					dataKey='squareAmount'
					name='Square入金'
					stackId='sales'
					fill='#0f766e'
					radius={[0, 0, 4, 4]}
				/>
				<Bar
					dataKey='invoiceAmount'
					name='Invoice入金'
					stackId='sales'
					fill='#2563eb'
					radius={[4, 4, 0, 0]}
				/>
			</BarChart>
		</ResponsiveContainer>
	)
}

export function PipelineAmountChart({
	data,
}: {
	data: SalesDashboardData['pipelineRows']
}) {
	return (
		<ResponsiveContainer width='100%' height='100%'>
			<BarChart data={data} layout='vertical' margin={{ left: 16 }}>
				<CartesianGrid strokeDasharray='3 3' horizontal={false} />
				<XAxis
					type='number'
					tickLine={false}
					axisLine={false}
					tickFormatter={value => compactJpy.format(Number(value))}
				/>
				<YAxis
					type='category'
					dataKey='pipeline'
					width={96}
					tickLine={false}
					axisLine={false}
				/>
				<Tooltip formatter={value => formatAmount(Number(value))} />
				<Bar
					dataKey='amount'
					name='案件金額'
					fill='#7c3aed'
					radius={[0, 4, 4, 0]}
				/>
			</BarChart>
		</ResponsiveContainer>
	)
}
