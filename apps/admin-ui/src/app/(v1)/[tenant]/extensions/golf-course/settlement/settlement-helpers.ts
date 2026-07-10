export type GolfMonthlySettlementPeriod = {
	yearMonth: string
	startDate: string
	endDate: string
}

export type GolfMonthlySettlementReport = {
	period: GolfMonthlySettlementPeriod
	reservations: {
		grossAmount: number
		collectedAmount: number
		refundedAmount: number
		paymentPendingAmount: number
		reservationCount: number
	}
	caddieFees: {
		total: number
		assignmentCount: number
		currency: string
	}
	cancellations: {
		feeOutstandingAmount: number
		count: number
	}
	square: {
		paymentsTotal: number
		refundsTotal: number
		unreconciledLines: number
		warning?: string | null
	}
	drilldown: {
		reservationIds: string[]
		unpaidCancellationReservationIds: string[]
		unpaidCancellationItems: GolfUnpaidCancellationItem[]
	}
}

export type GolfUnpaidCancellationItem = {
	reservationId: string
	reservationNumber: string
	cancellationFeeAmount: number
	checkoutUrl?: string | null
	linkIssued: boolean
	paymentStatus: string
	invoiceId?: string | null
}

export { defaultPayrollYearMonth as defaultSettlementYearMonth } from '../caddies/caddie-payroll-helpers'

export function formatYen(amount: number, currency = 'JPY'): string {
	if (currency !== 'JPY') {
		return `${amount.toLocaleString('en-US')} ${currency}`
	}
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0,
	}).format(amount)
}
