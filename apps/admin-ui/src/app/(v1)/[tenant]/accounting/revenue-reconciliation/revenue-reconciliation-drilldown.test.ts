import { describe, expect, it } from 'vitest'
import {
	filterReconciliationDrilldownRows,
	resolveReconciliationDrilldownFilter,
} from './drilldown-filter'
import type {
	AccountingPaymentReconciliation,
	AccountingSalesEvent,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import type { SquarePaymentReconciliation } from './actions'

describe('revenue reconciliation drilldown filters', () => {
	it('accepts camelCase and snake_case close readiness query aliases', () => {
		expect(
			resolveReconciliationDrilldownFilter({
				sourceType: 'ar_ap_settlement',
				sourceId: 'set_unmatched',
			}),
		).toEqual({
			sourceType: 'ar_ap_settlement',
			sourceId: 'set_unmatched',
		})

		expect(
			resolveReconciliationDrilldownFilter({
				source_type: 'ar_ap_settlement',
				source_id: 'payout_1',
			}),
		).toEqual({
			sourceType: 'ar_ap_settlement',
			sourceId: 'payout_1',
		})
	})

	it('narrows close review and Square rows to the requested source id', () => {
		const salesEvents: AccountingSalesEvent[] = [
			salesEvent({ id: 'sale_1', externalId: 'ext_1' }),
			salesEvent({ id: 'sale_2', externalId: 'ext_2' }),
		]
		const reconciliations: AccountingPaymentReconciliation[] = [
			reconciliation({ id: 'set_unmatched', payoutId: 'payout_1' }),
			reconciliation({ id: 'set_other', payoutId: 'payout_2' }),
		]
		const squarePayments: SquarePaymentReconciliation[] = [
			squarePayment({ id: 'sq_1', squarePaymentId: 'sqpay_1' }),
			squarePayment({ id: 'sq_2', squarePaymentId: 'sqpay_2' }),
		]

		const filtered = filterReconciliationDrilldownRows(
			{ salesEvents, reconciliations },
			squarePayments,
			'set_unmatched',
		)

		expect(filtered.salesEvents).toHaveLength(0)
		expect(filtered.reconciliations.map(item => item.id)).toEqual([
			'set_unmatched',
		])
		expect(filtered.squarePayments).toHaveLength(0)
	})
})

function salesEvent(
	overrides: Partial<AccountingSalesEvent>,
): AccountingSalesEvent {
	return {
		id: 'sale_1',
		provider: 'square',
		eventType: 'sale',
		externalId: 'ext_1',
		grossAmount: '1000',
		feeAmount: '30',
		netAmount: '970',
		taxAmount: '90',
		currency: 'JPY',
		description: null,
		journalEntryId: null,
		status: 'pending',
		eventDate: '2026-05-10',
		...overrides,
	}
}

function reconciliation(
	overrides: Partial<AccountingPaymentReconciliation>,
): AccountingPaymentReconciliation {
	return {
		id: 'set_unmatched',
		provider: 'square',
		payoutId: 'payout_1',
		depositAmount: '970',
		depositDate: '2026-05-11',
		journalEntryId: null,
		status: 'pending',
		...overrides,
	}
}

function squarePayment(
	overrides: Partial<SquarePaymentReconciliation>,
): SquarePaymentReconciliation {
	return {
		id: 'sq_1',
		tenantId: 'tenant-a',
		squarePaymentId: 'sqpay_1',
		squareEventId: null,
		amount: 970,
		currency: 'JPY',
		payerHint: null,
		receivedAt: '2026-05-11T00:00:00.000Z',
		status: 'Unmatched',
		matchedInvoiceId: null,
		matchReason: null,
		receiptEmailSentAt: null,
		createdAt: '2026-05-11T00:00:00.000Z',
		updatedAt: '2026-05-11T00:00:00.000Z',
		...overrides,
	}
}
