'use server'

import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry } from 'lib/reliable-fetch'

const GOLF_API_URL =
	process.env.TACHYON_FIELD_GOLF_API_URL ||
	process.env.TACHYONFIELD_GOLF_API_URL ||
	'https://tachyonfield-golf.txcloud.app'

const DEFAULT_TENANT_ID = 'scc'
const DEFAULT_PREFECTURE = 'hokkaido'
const DEFAULT_PLAYER_AGE = 42
const DEFAULT_TAXABLE_RATIO = 0.85
const DEFAULT_PRICE_ELASTICITY = -1.2
const DEFAULT_FIXED_COST = 300000
const DEFAULT_VARIABLE_COST_PER_VISITOR = 1500

export type CalculateGolfInput = {
	greenFee: number
	numHoles: 9 | 18
	cartFee?: number
	caddyFee?: number
}

export type CalculateGolfResult = {
	courseGrade: string
	taxRate: number
	taxAmount: number
	total: number
	breakdown: GolfCalculateResponse['breakdown']
}

type GolfCalculateResponse = {
	course_grade: string
	tax_amount: number
	breakdown: Array<{
		player_index: number
		fee: number
		exempt: boolean
		reason: string | null
	}>
}

export type SimulateRangeInput = {
	dateFrom: string
	dateTo: string
	numVisitorsMin: number
	numVisitorsMax: number
	avgGreenFee: number
}

export type SimulateRangeRow = {
	greenFee: number
	courseGrade: string
	visitors: number
	taxableVisitors: number
	revenue: number
	taxTotal: number
	variableCost: number
	fixedCost: number
	profit: number
	profitMarginPct: number
}

export type SimulateRangeResult = {
	projectedRevenueMin: number
	projectedRevenueMax: number
	taxTotal: number
	rows: SimulateRangeRow[]
	periodLabel: string
}

type GolfSimulateRangeResponse = {
	rows: Array<{
		green_fee: number
		course_grade: string
		visitors: number
		taxable_visitors: number
		revenue: number
		tax_total: number
		variable_cost: number
		fixed_cost: number
		profit: number
		profit_margin_pct: number
	}>
}

export type GolfActionResult<T> =
	| { success: true; data: T }
	| { success: false; message: string }

export async function calculateGolfFeeAction(
	input: CalculateGolfInput,
): Promise<GolfActionResult<CalculateGolfResult>> {
	const validationError = validateCalculateInput(input)
	if (validationError) return { success: false, message: validationError }

	const result = await golfApiFetch<GolfCalculateResponse>('/calculate', {
		tenant_id: DEFAULT_TENANT_ID,
		prefecture: DEFAULT_PREFECTURE,
		green_fee: Math.round(input.greenFee),
		players: [
			{
				age: DEFAULT_PLAYER_AGE,
				has_disability_cert: false,
			},
		],
	})

	if (!result.success) return result

	const cartFee = Math.round(input.cartFee ?? 0)
	const caddyFee = Math.round(input.caddyFee ?? 0)
	const taxAmount = result.data.tax_amount
	const total = Math.round(input.greenFee) + cartFee + caddyFee + taxAmount

	return {
		success: true,
		data: {
			courseGrade: result.data.course_grade,
			taxAmount,
			taxRate: input.greenFee > 0 ? (taxAmount / input.greenFee) * 100 : 0,
			total,
			breakdown: result.data.breakdown,
		},
	}
}

export async function simulateGolfRangeAction(
	input: SimulateRangeInput,
): Promise<GolfActionResult<SimulateRangeResult>> {
	const validationError = validateRangeInput(input)
	if (validationError) return { success: false, message: validationError }

	const avgGreenFee = Math.round(input.avgGreenFee)
	const visitorsMidpoint = Math.round(
		(input.numVisitorsMin + input.numVisitorsMax) / 2,
	)

	const result = await golfApiFetch<GolfSimulateRangeResponse>(
		'/simulate/range',
		{
			tenant_id: DEFAULT_TENANT_ID,
			prefecture: DEFAULT_PREFECTURE,
			green_fee_range: {
				min: avgGreenFee,
				max: avgGreenFee,
				step: 1,
			},
			base_visitors: visitorsMidpoint,
			base_green_fee: avgGreenFee,
			price_elasticity: DEFAULT_PRICE_ELASTICITY,
			taxable_ratio: DEFAULT_TAXABLE_RATIO,
			fixed_cost: DEFAULT_FIXED_COST,
			variable_cost_per_visitor: DEFAULT_VARIABLE_COST_PER_VISITOR,
		},
	)

	if (!result.success) return result

	const rows = result.data.rows.map(row => ({
		greenFee: row.green_fee,
		courseGrade: row.course_grade,
		visitors: row.visitors,
		taxableVisitors: row.taxable_visitors,
		revenue: row.revenue,
		taxTotal: row.tax_total,
		variableCost: row.variable_cost,
		fixedCost: row.fixed_cost,
		profit: row.profit,
		profitMarginPct: row.profit_margin_pct,
	}))
	const baseline = rows[0]
	const taxPerTaxableVisitor =
		baseline && baseline.taxableVisitors > 0
			? baseline.taxTotal / baseline.taxableVisitors
			: 0
	const projectedTaxMax = Math.round(
		input.numVisitorsMax * DEFAULT_TAXABLE_RATIO * taxPerTaxableVisitor,
	)

	return {
		success: true,
		data: {
			projectedRevenueMin: Math.round(input.numVisitorsMin * avgGreenFee),
			projectedRevenueMax: Math.round(input.numVisitorsMax * avgGreenFee),
			taxTotal: projectedTaxMax,
			rows,
			periodLabel: `${input.dateFrom} - ${input.dateTo}`,
		},
	}
}

async function golfApiFetch<T>(
	path: string,
	body: Record<string, unknown>,
): Promise<GolfActionResult<T>> {
	const session = await authWithCheck()
	const result = await fetchJsonWithRetry<T>(
		`${GOLF_API_URL.replace(/\/+$/, '')}${path}`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${session.accessToken}`,
			},
			body: JSON.stringify(body),
		},
	)

	if (!result.ok) {
		return { success: false, message: result.error.message }
	}

	return { success: true, data: result.data }
}

function validateCalculateInput(input: CalculateGolfInput) {
	if (!Number.isFinite(input.greenFee) || input.greenFee <= 0) {
		return 'グリーンフィーは1円以上で入力してください。'
	}
	if (input.numHoles !== 9 && input.numHoles !== 18) {
		return 'ホール数は9または18を選択してください。'
	}
	if (isNegative(input.cartFee) || isNegative(input.caddyFee)) {
		return '任意料金は0円以上で入力してください。'
	}
	return null
}

function validateRangeInput(input: SimulateRangeInput) {
	if (!input.dateFrom || !input.dateTo) {
		return '対象期間を入力してください。'
	}
	if (new Date(input.dateFrom) > new Date(input.dateTo)) {
		return '終了日は開始日以降にしてください。'
	}
	if (!Number.isFinite(input.avgGreenFee) || input.avgGreenFee <= 0) {
		return '平均グリーンフィーは1円以上で入力してください。'
	}
	if (!Number.isFinite(input.numVisitorsMin) || input.numVisitorsMin < 0) {
		return '最小来場者数は0以上で入力してください。'
	}
	if (
		!Number.isFinite(input.numVisitorsMax) ||
		input.numVisitorsMax < input.numVisitorsMin
	) {
		return '最大来場者数は最小来場者数以上で入力してください。'
	}
	return null
}

function isNegative(value: number | undefined) {
	return value !== undefined && (!Number.isFinite(value) || value < 0)
}
