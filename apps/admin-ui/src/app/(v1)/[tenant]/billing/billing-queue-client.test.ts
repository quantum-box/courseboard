import { describe, expect, it, vi } from 'vitest'
import { filterBillingQueueItems } from './billing-queue-client'
import type { BillingQueueItem } from './types'

vi.mock('components/ui/use-toast', () => ({
	useToast: () => ({ toast: vi.fn() }),
}))

const baseItem = {
	id: 'item',
	sourceId: 'source',
	title: 'Item',
	status: 'Sent',
	amount: 1000,
	currency: 'JPY',
	href: '/invoices/inv_1',
	actionLabel: '詳細',
	severity: 'warning',
	canResendPaymentLink: false,
	canUpdateFollowUp: true,
} satisfies Partial<BillingQueueItem>

function queueItem(overrides: Partial<BillingQueueItem>): BillingQueueItem {
	return {
		...baseItem,
		...overrides,
		id: overrides.id ?? baseItem.id,
		kind: overrides.kind ?? 'unpaid_invoice',
		sourceType: overrides.sourceType ?? 'invoice',
		sourceId: overrides.sourceId ?? baseItem.sourceId,
		title: overrides.title ?? baseItem.title,
		status: overrides.status ?? baseItem.status,
		amount: overrides.amount ?? baseItem.amount,
		currency: overrides.currency ?? baseItem.currency,
		href: overrides.href ?? baseItem.href,
		actionLabel: overrides.actionLabel ?? baseItem.actionLabel,
		severity: overrides.severity ?? baseItem.severity,
		canResendPaymentLink:
			overrides.canResendPaymentLink ?? baseItem.canResendPaymentLink,
		canUpdateFollowUp:
			overrides.canUpdateFollowUp ?? baseItem.canUpdateFollowUp,
	}
}

describe('filterBillingQueueItems', () => {
	it('includes overdue invoices and overdue AR receivables in the overdue filter', () => {
		const items = [
			queueItem({ id: 'invoice', kind: 'overdue_invoice' }),
			queueItem({
				id: 'ar-overdue',
				kind: 'ar_receivable',
				sourceType: 'ar_receivable',
				dueDate: '2026-01-01',
			}),
			queueItem({
				id: 'ar-future',
				kind: 'ar_receivable',
				sourceType: 'ar_receivable',
				dueDate: '2999-01-01',
			}),
			queueItem({
				id: 'exception',
				kind: 'reconciliation_exception',
				sourceType: 'square_reconciliation',
				canUpdateFollowUp: false,
			}),
		]

		expect(
			filterBillingQueueItems(items, 'overdue').map(item => item.id),
		).toEqual(['invoice', 'ar-overdue'])
	})

	it('keeps partially paid and exception filters scoped to their collection categories', () => {
		const items = [
			queueItem({ id: 'partial', kind: 'partially_paid' }),
			queueItem({
				id: 'exception',
				kind: 'reconciliation_exception',
				sourceType: 'square_reconciliation',
				canUpdateFollowUp: false,
			}),
			queueItem({ id: 'invoice', kind: 'unpaid_invoice' }),
		]

		expect(
			filterBillingQueueItems(items, 'partially_paid').map(item => item.id),
		).toEqual(['partial'])
		expect(
			filterBillingQueueItems(items, 'exception').map(item => item.id),
		).toEqual(['exception'])
	})
})
