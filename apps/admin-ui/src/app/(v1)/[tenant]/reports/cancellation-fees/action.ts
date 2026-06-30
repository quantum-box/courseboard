'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry } from 'lib/reliable-fetch'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type CancellationFeeReportItem = {
	reservationId: string
	reservationNumber: string
	customerName?: string | null
	customerEmail?: string | null
	cancellationStatus: string
	paymentStatus: string
	cancellationFeeAmount: number
	refundAmount: number
	paidAmount: number
	currency: string
	squarePaymentLinkId?: string | null
	squarePaymentId?: string | null
	checkoutUrl?: string | null
	cancelledAt?: string | null
	createdAt: string
}

export async function fetchCancellationFeeReportAction(
	tenant: string,
	from?: string,
	to?: string,
) {
	const session = await authWithCheck()
	const params = new URLSearchParams()
	if (from) params.set('from', from)
	if (to) params.set('to', to)
	const search = params.size > 0 ? `?${params.toString()}` : ''
	const result = await fetchJsonWithRetry<{
		items: CancellationFeeReportItem[]
	}>(
		joinServerBackendPath(
			`/v1/erp/reservation-reports/cancellation-fees${search}`,
		),
		{
			headers: {
				'Content-Type': 'application/json',
				'x-platform-id': PLATFORM_ID,
				'x-operator-id': tenant,
				Authorization: `Bearer ${session.accessToken}`,
			},
			cache: 'no-store',
		},
	)
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	return { success: true as const, data: result.data.items }
}
