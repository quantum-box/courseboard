import type { InvoiceData, InvoiceStatus } from './action'

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
	Draft: '下書き',
	Sent: '送付済',
	SendFailed: '送信失敗',
	Paid: '入金済',
	Overdue: '期限超過',
}

export const invoiceStatusVariants: Record<
	InvoiceStatus,
	'default' | 'secondary' | 'destructive' | 'outline'
> = {
	Draft: 'secondary',
	Sent: 'outline',
	SendFailed: 'destructive',
	Paid: 'default',
	Overdue: 'destructive',
}

export type InvoiceListSummary = {
	totalCount: number
	totalAmount: number
	unpaidCount: number
	unpaidAmount: number
	overdueCount: number
	paidAmount: number
}

export function summarizeInvoices(invoices: InvoiceData[]): InvoiceListSummary {
	return invoices.reduce<InvoiceListSummary>(
		(summary, invoice) => {
			summary.totalCount += 1
			summary.totalAmount += invoice.totalAmount
			if (invoice.status === 'Paid') {
				summary.paidAmount += invoice.totalAmount
			} else {
				summary.unpaidCount += 1
				summary.unpaidAmount += invoice.totalAmount
			}
			if (invoice.status === 'Overdue') {
				summary.overdueCount += 1
			}
			return summary
		},
		{
			totalCount: 0,
			totalAmount: 0,
			unpaidCount: 0,
			unpaidAmount: 0,
			overdueCount: 0,
			paidAmount: 0,
		},
	)
}
