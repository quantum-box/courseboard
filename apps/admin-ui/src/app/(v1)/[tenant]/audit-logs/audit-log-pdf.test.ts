import { describe, expect, it } from 'vitest'
import { buildSimplePdf, summarizeAuditLogs } from './audit-log-pdf'
import type { AuditLog } from './actions'

const baseLog: AuditLog = {
	id: 'al_1',
	tenantId: 'tn_1',
	actorId: 'us_1',
	actorType: 'user',
	resourceType: 'invoice',
	resourceId: 'inv_1',
	action: 'erp:invoices:update',
	createdAt: '2026-05-16T00:00:00.000Z',
}

describe('audit log PDF helpers', () => {
	it('summarizes ERP audit actions without expanding diff metadata', () => {
		const lines = summarizeAuditLogs([
			baseLog,
			{ ...baseLog, id: 'al_2', action: 'erp:invoices:update' },
			{ ...baseLog, id: 'al_3', action: 'iam:role:assign' },
		])

		expect(lines).toContain('erp:invoices:update: 2')
		expect(lines).toContain('iam:role:assign: 1')
		expect(lines.join('\n')).toContain('invoice:inv_1')
	})

	it('builds a minimal PDF document', () => {
		const pdf = buildSimplePdf(['TACHYON Field ERP Audit Summary'])

		expect(pdf.startsWith('%PDF-1.4')).toBe(true)
		expect(pdf).toContain('/BaseFont /Helvetica')
		expect(pdf).toContain('%%EOF')
	})
})
