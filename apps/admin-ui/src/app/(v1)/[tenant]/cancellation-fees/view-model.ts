import type { InvoiceData } from '../invoices/action'
import { summarizeInvoices } from '../invoices/view-model'

export type CancellationFeeSummary = ReturnType<typeof summarizeInvoices>

export function summarizeCancellationFees(invoices: InvoiceData[]) {
	return summarizeInvoices(invoices)
}
