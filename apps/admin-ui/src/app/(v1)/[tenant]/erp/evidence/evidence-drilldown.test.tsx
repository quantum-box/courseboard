import { describe, expect, it } from 'vitest'
import { resolveEvidenceDrilldownFilter } from './drilldown-filter'

describe('evidence drilldown filters', () => {
	it('maps close readiness query aliases into the initial evidence search filter', () => {
		expect(
			resolveEvidenceDrilldownFilter({
				sourceType: 'evidence',
				sourceId: 'evd_ocr',
				ocr_review_status: 'needs_review',
			}),
		).toEqual({
			sourceModule: 'evidence',
			sourceId: 'evd_ocr',
			ocrReviewStatus: 'needs_review',
		})

		expect(
			resolveEvidenceDrilldownFilter({
				source_type: 'evidence_audit',
				source_id: 'evd_changed',
				auditEvent: 'changed_after_close',
			}),
		).toEqual({
			sourceModule: 'evidence_audit',
			sourceId: 'evd_changed',
			auditAction: 'changed_after_close',
		})
	})

	it('preserves unsupported drilldown hints while still applying source id', () => {
		expect(
			resolveEvidenceDrilldownFilter({
				reviewStatus: 'missing',
				sourceType: 'evidence',
				sourceId: 'jnl_missing',
			}),
		).toEqual({
			status: 'missing',
			sourceModule: 'evidence',
			sourceId: 'jnl_missing',
		})
	})
})
