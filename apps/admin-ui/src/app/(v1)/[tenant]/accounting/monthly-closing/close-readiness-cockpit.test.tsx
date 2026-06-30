import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CloseReadinessCockpit } from './close-readiness-cockpit'

describe('CloseReadinessCockpit', () => {
	it('renders all close blocker classes with source links and remediation hints', () => {
		const html = renderToStaticMarkup(
			<CloseReadinessCockpit
				prefix=''
				tenant='tenant-a'
				readiness={{
					companyId: 'tenant-a',
					yearMonth: '2026-05',
					periodStart: '2026-05-01',
					periodEnd: '2026-05-31',
					status: 'open',
					blockerCount: 6,
					criticalCount: 5,
					warningCount: 1,
					generatedFromIssueCount: 6,
					blockers: [
						{
							kind: 'missing_evidence',
							label: '証憑欠落',
							severity: 'critical',
							count: 1,
							sourceType: 'evidence',
							sourceId: 'jnl_missing',
							drilldownPath: '/erp/evidence?reviewStatus=missing',
							drilldownUrl:
								'/erp/evidence?reviewStatus=missing&sourceType=evidence&sourceId=jnl_missing',
							description: '主証憑が不足しています。',
							remediationHint: '主証憑を添付してください。',
							sampleSourceIds: ['jnl_missing'],
						},
						{
							kind: 'ocr_unreviewed',
							label: 'OCR未レビュー',
							severity: 'critical',
							count: 1,
							sourceType: 'evidence',
							sourceId: 'evd_ocr',
							drilldownPath: '/erp/evidence?ocr_review_status=needs_review',
							drilldownUrl:
								'/erp/evidence?ocr_review_status=needs_review&sourceType=evidence&sourceId=evd_ocr',
							description: 'OCR結果が未確認です。',
							remediationHint: 'OCR結果を確認してください。',
							sampleSourceIds: ['evd_ocr'],
						},
						{
							kind: 'hash_unverified',
							label: 'ハッシュ未検証',
							severity: 'critical',
							count: 1,
							sourceType: 'evidence',
							sourceId: 'evd_hash',
							drilldownPath: '/erp/evidence?verification_status=unverified',
							drilldownUrl:
								'/erp/evidence?verification_status=unverified&sourceType=evidence&sourceId=evd_hash',
							description: 'ハッシュ検証が未完了です。',
							remediationHint: 'ハッシュ検証を再実行してください。',
							sampleSourceIds: ['evd_hash'],
						},
						{
							kind: 'payment_reconciliation_exception',
							label: '支払照合例外',
							severity: 'critical',
							count: 1,
							sourceType: 'ar_ap_settlement',
							sourceId: 'set_unmatched',
							drilldownPath: '/accounting/revenue-reconciliation',
							drilldownUrl:
								'/accounting/revenue-reconciliation?sourceType=ar_ap_settlement&sourceId=set_unmatched',
							description: '照合が未完了です。',
							remediationHint: '未照合明細を紐づけてください。',
							sampleSourceIds: ['set_unmatched'],
						},
						{
							kind: 'changed_after_close',
							label: '締め後変更',
							severity: 'critical',
							count: 1,
							sourceType: 'evidence_audit',
							sourceId: 'evd_changed',
							drilldownPath: '/erp/evidence?auditEvent=changed_after_close',
							drilldownUrl:
								'/erp/evidence?auditEvent=changed_after_close&sourceType=evidence_audit&sourceId=evd_changed',
							description: '締め後変更があります。',
							remediationHint: '変更内容を確認してください。',
							sampleSourceIds: ['evd_changed'],
						},
						{
							kind: 'legal_hold_warning',
							label: '保全確認警告',
							severity: 'warning',
							count: 1,
							sourceType: 'evidence_legal_hold',
							sourceId: 'elh_1',
							drilldownPath: '/erp/evidence?legalHold=active',
							drilldownUrl:
								'/erp/evidence?legalHold=active&sourceType=evidence_legal_hold&sourceId=elh_1',
							description: '保全対象があります。',
							remediationHint: '担当者確認状況を確認してください。',
							sampleSourceIds: ['elh_1'],
						},
					],
				}}
			/>,
		)

		expect(html).toContain('締め前コックピット')
		expect(html).toContain('証憑欠落')
		expect(html).toContain('OCR未レビュー')
		expect(html).toContain('ハッシュ未検証')
		expect(html).toContain('支払照合例外')
		expect(html).toContain('締め後変更')
		expect(html).toContain('保全確認警告')
		expect(html).toContain('evidence:jnl_missing')
		expect(html).toContain('主証憑を添付してください')
		expect(html).toContain(
			'/tenant-a/erp/evidence?reviewStatus=missing&amp;sourceType=evidence&amp;sourceId=jnl_missing',
		)
		expect(html).not.toContain('法令')
		expect(html).not.toContain('税務')
		expect(html).not.toContain('Legal hold')
	})
})
