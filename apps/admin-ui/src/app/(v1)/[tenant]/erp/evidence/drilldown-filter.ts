import type { EvidenceSearchFilter } from './actions'

export type EvidenceSearchParams = {
	sourceId?: string
	source_id?: string
	sourceType?: string
	source_type?: string
	sourceModule?: string
	source_module?: string
	verificationStatus?: string
	verification_status?: string
	ocrReviewStatus?: string
	ocr_review_status?: string
	auditAction?: string
	audit_action?: string
	auditEvent?: string
	status?: string
	reviewStatus?: string
	review_status?: string
}

function firstParam(...values: Array<string | undefined>) {
	return values.find(value => value && value.trim().length > 0)
}

export function resolveEvidenceDrilldownFilter(
	searchParams: EvidenceSearchParams = {},
): EvidenceSearchFilter {
	const filter: EvidenceSearchFilter = {}
	const sourceId = firstParam(searchParams.sourceId, searchParams.source_id)
	const sourceModule = firstParam(
		searchParams.sourceType,
		searchParams.source_type,
		searchParams.sourceModule,
		searchParams.source_module,
	)
	const verificationStatus = firstParam(
		searchParams.verificationStatus,
		searchParams.verification_status,
	)
	const ocrReviewStatus = firstParam(
		searchParams.ocrReviewStatus,
		searchParams.ocr_review_status,
	)
	const auditAction = firstParam(
		searchParams.auditAction,
		searchParams.audit_action,
		searchParams.auditEvent,
	)
	const status = firstParam(
		searchParams.status,
		searchParams.reviewStatus,
		searchParams.review_status,
	)
	if (sourceId) filter.sourceId = sourceId
	if (sourceModule) filter.sourceModule = sourceModule
	if (verificationStatus) filter.verificationStatus = verificationStatus
	if (ocrReviewStatus) filter.ocrReviewStatus = ocrReviewStatus
	if (auditAction) filter.auditAction = auditAction
	if (status) filter.status = status
	return filter
}
