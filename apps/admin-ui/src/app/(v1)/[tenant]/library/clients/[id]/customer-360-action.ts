import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import {
	type ActionResult,
	type ArApItem,
	type AuditLogItem,
	buildCustomer360Data,
	type ConsumerOrderItem,
	type Customer360Data,
	type DealItem,
	type EvidenceSearchItem,
	type InvoiceItem,
	type OrderItem,
	type QuotationItem,
	type ReservationItem,
} from './customer-360-format'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

async function apiFetchJson<T>(
	path: string,
	tenantId: string,
): Promise<ActionResult<T>> {
	const session = await authWithCheck()
	try {
		const response = await fetch(joinServerBackendPath(path), {
			headers: {
				'Content-Type': 'application/json',
				'x-platform-id': PLATFORM_ID,
				'x-operator-id': tenantId,
				Authorization: `Bearer ${session.accessToken}`,
			},
		})

		if (!response.ok) {
			return { success: false, message: await response.text() }
		}

		return { success: true, data: (await response.json()) as T }
	} catch (error) {
		return {
			success: false,
			message:
				error instanceof Error
					? error.message
					: 'Failed to fetch customer data',
		}
	}
}

export async function fetchCustomer360Action(
	tenantId: string,
	client: { id: string; name?: string | null },
): Promise<ActionResult<Customer360Data>> {
	const clientParams = new URLSearchParams({ client_id: client.id, limit: '8' })
	const reservationParams = new URLSearchParams({
		customer_id: client.id,
		limit: '8',
	})
	const consumerOrderParams = new URLSearchParams({
		customer_id: client.id,
		limit: '8',
	})
	const arApParams = new URLSearchParams({
		counterparty: client.id,
		limit: '8',
	})
	const evidenceParams = new URLSearchParams({
		limit: '8',
		sort_by: 'transaction_date',
		sort_direction: 'desc',
	})
	if (client.name) {
		evidenceParams.set('counterparty', client.name)
	}
	const auditParams = new URLSearchParams({
		resource_type: 'customer',
		resource_id: client.id,
		limit: '8',
	})

	const [
		deals,
		quotations,
		orders,
		consumerOrders,
		reservations,
		invoices,
		arAp,
		evidence,
		auditReferences,
	] = await Promise.all([
		apiFetchJson<{ items: DealItem[] }>(
			`/v1/erp/deals?${clientParams.toString()}`,
			tenantId,
		),
		apiFetchJson<{ items: QuotationItem[] }>(
			`/v1/erp/quotations?${clientParams.toString()}`,
			tenantId,
		),
		apiFetchJson<{ items: OrderItem[] }>(
			`/v1/erp/orders?${clientParams.toString()}`,
			tenantId,
		),
		apiFetchJson<{ items: ConsumerOrderItem[] }>(
			`/v1/storekit/orders?${consumerOrderParams.toString()}`,
			tenantId,
		),
		apiFetchJson<{ items: ReservationItem[] }>(
			`/v1/erp/reservations?${reservationParams.toString()}`,
			tenantId,
		),
		apiFetchJson<{ items: InvoiceItem[] }>(
			`/v1/invoices?${clientParams.toString()}`,
			tenantId,
		),
		apiFetchJson<{ items: ArApItem[] }>(
			`/v1/erp/ar-ap/items?${arApParams.toString()}`,
			tenantId,
		),
		client.name
			? apiFetchJson<{ items: EvidenceSearchItem[] }>(
					`/v1/erp/evidence/search?${evidenceParams.toString()}`,
					tenantId,
				)
			: Promise.resolve<ActionResult<{ items: EvidenceSearchItem[] }>>({
					success: true,
					data: { items: [] },
				}),
		apiFetchJson<{ items: AuditLogItem[] }>(
			`/v1/audit-logs?${auditParams.toString()}`,
			tenantId,
		),
	])

	return {
		success: true,
		data: buildCustomer360Data({
			deals,
			quotations,
			orders,
			consumerOrders,
			reservations,
			invoices,
			arAp,
			evidence,
			auditReferences,
		}),
	}
}
