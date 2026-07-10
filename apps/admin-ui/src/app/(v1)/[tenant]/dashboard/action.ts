'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { getGraphqlSdk } from 'lib/graphqlClient'
import {
	listLowStockAlerts,
	listStockLevels,
} from '../procurement/_lib/erp-api'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type SalesDashboardData = {
	period: string
	summary: {
		totalSales: number
		squareSales: number
		invoiceSales: number
		unpaidInvoiceCount: number
		unpaidInvoiceAmount: number
		newCustomersThisMonth: number
	}
	monthlySales: {
		month: string
		squareAmount: number
		invoiceAmount: number
		totalAmount: number
	}[]
	pipelineRows: {
		pipeline: string
		dealCount: number
		amount: number
	}[]
	recentTransactions: {
		id: string
		source: string
		customerName?: string | null
		amount: number
		status: string
		occurredAt: string
	}[]
}

export type HomeDashboardPeriod = 'today' | '7d' | '30d' | 'month'

export type HomeDashboardMetric = {
	value: number | null
	error: string | null
}

export type HomeDashboardData = {
	period: HomeDashboardPeriod
	dateFrom: string
	dateTo: string
	metrics: {
		salesJpy: HomeDashboardMetric
		orderCount: HomeDashboardMetric
		inventoryAlerts: HomeDashboardMetric
		bopisPending: HomeDashboardMetric
		newCustomers: HomeDashboardMetric
	}
	errors: string[]
}

type ConsumerOrder = {
	id: string
	status: string
	fulfillmentMethod?: string | null
	customerId?: string | null
	customerEmail?: string | null
	userId?: string | null
	createdAt: string
}

export async function fetchSalesDashboardAction(
	tenant: string,
	dateFrom: string,
	dateTo: string,
): Promise<SalesDashboardData> {
	const session = await authWithCheck()
	const params = new URLSearchParams({
		date_from: dateFrom,
		date_to: dateTo,
	})
	const res = await fetch(
		joinServerBackendPath(`/v1/erp/sales-dashboard?${params}`),
		{
			headers: {
				'Content-Type': 'application/json',
				'x-platform-id': PLATFORM_ID,
				'x-operator-id': tenant,
				Authorization: `Bearer ${session.accessToken}`,
			},
		},
	)

	if (!res.ok) {
		throw new Error(await res.text())
	}

	return (await res.json()) as SalesDashboardData
}

function resolveHomeDashboardRange(
	period: HomeDashboardPeriod,
	now = new Date(),
) {
	const end = new Date(now)
	end.setHours(23, 59, 59, 999)
	const start = new Date(now)
	start.setHours(0, 0, 0, 0)

	if (period === '7d') {
		start.setDate(start.getDate() - 6)
	} else if (period === '30d') {
		start.setDate(start.getDate() - 29)
	} else if (period === 'month') {
		start.setDate(1)
	}

	return {
		dateFrom: formatDate(start),
		dateTo: formatDate(end),
		start,
		end,
	}
}

export async function fetchHomeDashboardAction(
	tenant: string,
	period: HomeDashboardPeriod,
): Promise<HomeDashboardData> {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	const range = resolveHomeDashboardRange(period)
	const errors: string[] = []

	const [salesResult, ordersResult, stockLevelsResult, lowStockResult] =
		await Promise.allSettled([
			fetchSalesDashboardAction(tenant, range.dateFrom, range.dateTo),
			sdk.getConsumerOrdersForAdmin({ limit: 1000, offset: 0 }),
			listStockLevels(tenant),
			listLowStockAlerts(tenant),
		])

	const salesJpy: HomeDashboardMetric =
		salesResult.status === 'fulfilled'
			? { value: salesResult.value.summary.totalSales, error: null }
			: metricError(
					'売上データを取得できませんでした',
					salesResult.reason,
					errors,
				)

	const orders =
		ordersResult.status === 'fulfilled'
			? ordersResult.value.consumerOrders.items.filter(order =>
					isWithinRange(order.createdAt, range.start, range.end),
				)
			: null
	const isOrderSourceUnavailable =
		ordersResult.status === 'rejected' &&
		(isCommerceApiNotFoundError(ordersResult.reason) ||
			isAuthorizationError(ordersResult.reason))
	if (
		ordersResult.status === 'rejected' &&
		!isOrderSourceUnavailable &&
		!isGraphqlResponseError(ordersResult.reason)
	) {
		errors.push(
			errorMessage('注文データを取得できませんでした', ordersResult.reason),
		)
	}
	const orderMetricError = isOrderSourceUnavailable
		? '注文連携が未設定です'
		: '注文データを取得できませんでした'

	const orderCount: HomeDashboardMetric = orders
		? { value: orders.length, error: null }
		: { value: null, error: orderMetricError }

	const bopisPending: HomeDashboardMetric = orders
		? {
				value: orders.filter(isPendingPickupOrder).length,
				error: null,
			}
		: {
				value: null,
				error: isOrderSourceUnavailable
					? '注文連携が未設定です'
					: '店舗受取データを取得できませんでした',
			}

	const newCustomers: HomeDashboardMetric = orders
		? { value: countNewCustomerKeys(orders), error: null }
		: {
				value: null,
				error: isOrderSourceUnavailable
					? '注文連携が未設定です'
					: '顧客データを取得できませんでした',
			}

	if (stockLevelsResult.status === 'rejected') {
		errors.push(
			errorMessage(
				'在庫データを取得できませんでした',
				stockLevelsResult.reason,
			),
		)
	}
	const inventoryAlerts: HomeDashboardMetric =
		lowStockResult.status === 'fulfilled'
			? { value: lowStockResult.value.items.length, error: null }
			: metricError(
					'在庫アラートを取得できませんでした',
					lowStockResult.reason,
					errors,
				)

	return {
		period,
		dateFrom: range.dateFrom,
		dateTo: range.dateTo,
		metrics: {
			salesJpy,
			orderCount,
			inventoryAlerts,
			bopisPending,
			newCustomers,
		},
		errors,
	}
}

function formatDate(date: Date) {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-')
}

function isWithinRange(value: string, start: Date, end: Date) {
	const date = new Date(value)
	return Number.isFinite(date.getTime()) && date >= start && date <= end
}

function isPendingPickupOrder(order: ConsumerOrder) {
	return (
		order.fulfillmentMethod === 'pickup' &&
		!['cancelled', 'delivered', 'picked_up', 'refunded'].includes(order.status)
	)
}

function countNewCustomerKeys(orders: ConsumerOrder[]) {
	return new Set(
		orders
			.map(
				order =>
					order.customerId ?? order.customerEmail ?? order.userId ?? order.id,
			)
			.filter(Boolean),
	).size
}

function metricError(
	message: string,
	reason: unknown,
	errors: string[],
): HomeDashboardMetric {
	errors.push(errorMessage(message, reason))
	return { value: null, error: message }
}

function errorMessage(message: string, reason: unknown) {
	if (isAuthorizationError(reason) || isGraphqlResponseError(reason)) {
		return message
	}
	return reason instanceof Error ? `${message}: ${reason.message}` : message
}

function isCommerceApiNotFoundError(reason: unknown) {
	return (
		reason instanceof Error &&
		reason.message.includes('Commerce API error (404)')
	)
}

function isAuthorizationError(reason: unknown) {
	return (
		reason instanceof Error &&
		/(Unauthorized|evaluate_policies_batch|policy denied|permission_denied)/i.test(
			reason.message,
		)
	)
}

function isGraphqlResponseError(reason: unknown) {
	return (
		reason instanceof Error &&
		reason.message.includes('"response"') &&
		reason.message.includes('"errors"')
	)
}
