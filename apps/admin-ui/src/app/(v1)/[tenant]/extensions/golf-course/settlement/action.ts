'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
import type { GolfMonthlySettlementReport } from './settlement-helpers'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

function settlementPath(tenant: string) {
	return `/${tenant}/extensions/golf-course/settlement`
}

async function golfHeaders(tenant: string) {
	const session = await authWithCheck()
	return {
		'Content-Type': 'application/json',
		'x-platform-id': PLATFORM_ID,
		'x-operator-id': tenant,
		Authorization: `Bearer ${session.accessToken}`,
	}
}

async function golfFetchJson<T>(path: string, tenant: string) {
	const result = await fetchJsonWithRetry<T>(joinServerBackendPath(path), {
		headers: await golfHeaders(tenant),
	})
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	return { success: true as const, data: result.data }
}

async function golfFetch(path: string, tenant: string, init?: RequestInit) {
	return fetchWithRetry(joinServerBackendPath(path), {
		...init,
		headers: {
			...(await golfHeaders(tenant)),
			...(init?.headers ?? {}),
		},
	})
}

export async function fetchGolfMonthlySettlementAction(
	tenant: string,
	yearMonth: string,
) {
	return golfFetchJson<GolfMonthlySettlementReport>(
		`/v1/erp/extensions/golf-course/monthly-settlement?yearMonth=${encodeURIComponent(yearMonth)}`,
		tenant,
	)
}

export async function downloadGolfMonthlySettlementCsvAction(
	tenant: string,
	yearMonth: string,
) {
	const response = await golfFetch(
		`/v1/erp/extensions/golf-course/monthly-settlement/export.csv?yearMonth=${encodeURIComponent(yearMonth)}`,
		tenant,
	)
	if (!response.ok) {
		return {
			success: false as const,
			message: response.error.message,
		}
	}
	const csv = await response.response.text()
	return {
		success: true as const,
		csv,
		filename: `golf-monthly-settlement-${yearMonth}.csv`,
	}
}

export async function revalidateSettlementPageAction(tenant: string) {
	const { revalidatePath } = await import('next/cache')
	revalidatePath(settlementPath(tenant))
}

type IssueSquareInvoiceResponse = {
	checkoutUrl: string
	reusedExistingInvoice: boolean
}

export async function issueGolfCancellationSquareInvoiceAction(
	tenant: string,
	reservationId: string,
) {
	const response = await golfFetch(
		`/v1/erp/reservations/${reservationId}/billing-invoice`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({}),
		},
	)
	if (!response.ok) {
		return { success: false as const, message: response.error.message }
	}
	const data = (await response.response.json()) as IssueSquareInvoiceResponse
	const { revalidatePath } = await import('next/cache')
	revalidatePath(settlementPath(tenant))
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reports/cancellation-fees`)
	return {
		success: true as const,
		checkoutUrl: data.checkoutUrl,
		reusedExistingInvoice: data.reusedExistingInvoice,
	}
}
