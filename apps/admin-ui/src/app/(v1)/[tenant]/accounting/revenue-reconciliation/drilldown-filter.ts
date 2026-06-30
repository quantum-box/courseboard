import type {
	AccountingPaymentReconciliation,
	AccountingSalesEvent,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import type { SquarePaymentReconciliation } from './actions'

export type ReconciliationSearchParams = {
	companyId?: string
	sourceId?: string
	source_id?: string
	sourceType?: string
	source_type?: string
}

function firstParam(...values: Array<string | undefined>) {
	return values.find(value => value && value.trim().length > 0)
}

export function resolveReconciliationDrilldownFilter(
	searchParams: ReconciliationSearchParams = {},
) {
	return {
		sourceId: firstParam(searchParams.sourceId, searchParams.source_id),
		sourceType: firstParam(searchParams.sourceType, searchParams.source_type),
	}
}

function matchesSourceId(
	item: {
		id?: string | null
		externalId?: string | null
		payoutId?: string | null
		journalEntryId?: string | null
		squarePaymentId?: string | null
		matchedInvoiceId?: string | null
	},
	sourceId?: string,
) {
	if (!sourceId) return true
	return [
		item.id,
		item.externalId,
		item.payoutId,
		item.journalEntryId,
		item.squarePaymentId,
		item.matchedInvoiceId,
	].some(value => value === sourceId)
}

export function filterReconciliationDrilldownRows(
	review: {
		salesEvents: AccountingSalesEvent[]
		reconciliations: AccountingPaymentReconciliation[]
	},
	squarePayments: SquarePaymentReconciliation[],
	sourceId?: string,
) {
	return {
		salesEvents: review.salesEvents.filter(item =>
			matchesSourceId(item, sourceId),
		),
		reconciliations: review.reconciliations.filter(item =>
			matchesSourceId(item, sourceId),
		),
		squarePayments: squarePayments.filter(item =>
			matchesSourceId(item, sourceId),
		),
	}
}
